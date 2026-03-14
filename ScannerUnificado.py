import time
import random
import logging
import requests
import argparse
import json
from urllib.parse import urlparse, urljoin
from collections import deque
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import WebDriverException, TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from queue import Queue
from threading import Thread

API_BASE_URL = "http://localhost:3000"
logging.basicConfig(filename='scanner_unificado.log', level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - [%(session_id)s] - %(message)s')
REQUESTS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36'
}
PROXIES = {"http": None, "https": None}


def enviar_link_api(link_data, session_id):
    try:
        link_data['session_id'] = session_id
        requests.post(f"{API_BASE_URL}/links", json=link_data, timeout=20, proxies=PROXIES)
    except requests.exceptions.RequestException as e:
        logging.error(f"API Exception (enviar_link): {e}")


def atualizar_sessao_api(session_id, status, total_links, depthReached=None, error_message=None):
    try:
        payload = {"status": status, "total_links": total_links}
        if depthReached is not None: payload['depthReached'] = depthReached
        if error_message is not None: payload['errorMessage'] = error_message
        requests.patch(f"{API_BASE_URL}/scan-session/{session_id}", json=payload, timeout=20, proxies=PROXIES)
    except requests.exceptions.RequestException as e:
        logging.error(f"API Exception (atualizar_sessao): {e}")


def atualizar_status_link_api(url, session_id, status, http_code=None, final_url=None):
    try:
        payload = {"status": status}
        if http_code is not None: payload['httpCode'] = http_code
        if final_url is not None: payload['finalUrl'] = final_url
        requests.patch(f"{API_BASE_URL}/links/by-url?url={requests.utils.quote(url)}&session_id={session_id}",
                       json=payload, timeout=20, proxies=PROXIES)
    except requests.exceptions.RequestException as e:
        logging.error(f"API Exception (atualizar_status_link): {e}")


def verificar_link_status(url):
    try:
        resposta = requests.head(url, headers=REQUESTS_HEADERS, timeout=10, allow_redirects=True, proxies=PROXIES)
        http_code = resposta.status_code
        final_url = resposta.url

        if http_code >= 400:
            if http_code == 405:
                try:
                    resposta = requests.get(url, headers=REQUESTS_HEADERS, timeout=10, allow_redirects=True, proxies=PROXIES)
                    http_code = resposta.status_code
                    final_url = resposta.url
                except requests.exceptions.RequestException:
                    return {"status": "Timeout", "httpCode": None, "finalUrl": url}
                
                if http_code < 400:
                    pass
                else:
                    return {"status": f"Erro {http_code} (HEAD falhou)", "httpCode": http_code, "finalUrl": final_url}
            else:
                return {"status": f"Erro {http_code}", "httpCode": http_code, "finalUrl": final_url}

        if http_code < 400:
            content_response = requests.get(final_url, headers=REQUESTS_HEADERS, timeout=10,
                                            allow_redirects=True, proxies=PROXIES, stream=True)

            content_sample = ""
            try:
                for chunk in content_response.iter_content(chunk_size=4096, decode_unicode=True):
                    if chunk:
                        content_sample += str(chunk)[:5000]  
                        break
            except Exception as e:
                try:
                    content_response.close() 
                    full_content_response = requests.get(final_url, headers=REQUESTS_HEADERS, timeout=10, allow_redirects=False, proxies=PROXIES)
                    content_sample = full_content_response.text[:5000] 
                except:
                    pass
            finally:
                 if 'content_response' in locals() and content_response is not None:
                     content_response.close()


            if is_error_page(content_sample, final_url):
                return {"status": "Erro (página não encontrada)", "httpCode": 404, "finalUrl": final_url}

        status = "Funcionando"
        return {"status": status, "httpCode": http_code, "finalUrl": final_url}

    except requests.exceptions.Timeout:
        return {"status": "Timeout", "httpCode": None, "finalUrl": url}
    except requests.exceptions.RequestException as e:
        return {"status": f"Erro de Conexão ({type(e).__name__})", "httpCode": None, "finalUrl": url}


def is_error_page(content, url):

    if not content:
        return False

    content_lower = content.lower()

    error_patterns = [
        'página não encontrada',
        'página não existe',
        'error 404',
        'not found',
        'página indisponível',
        'conteúdo não encontrado',
        'não encontramos a página',
        'esta página não existe',
        'url não encontrada',
        '404 not found',
        'page not found',
        'the page cannot be found',
        'não foi possível encontrar',
        'erro 404',
        'página em manutenção',
        'em construção',
        'volte mais tarde',
        'serviço temporariamente indisponível',
        'página indisponível',
        'página em manutenção',
        'em construção',
        'volte mais tarde',
        'serviço temporariamente indisponível',
        'página excluída', 
        'link inválido', 
        'url inválida', 
        'não existe nesta url' 
    ]

    for pattern in error_patterns:
        if pattern in content_lower:
            return True

    parsed_url = urlparse(url)
    error_paths = ['/404', '/error', '/erro', '/not-found', '/pagina-nao-encontrada']
    if any(error_path in parsed_url.path for error_path in error_paths):
        return True

    title_patterns = ['<title>.*404.*</title>', '<title>.*not found.*</title>', '<title>.*error.*</title>']
    import re
    for pattern in title_patterns:
        if re.search(pattern, content_lower):
            return True

    return False


class Scanner:
    def __init__(self, base_url, session_id, max_depth, headless=True):
        self.base_url = base_url
        self.base_domain = urlparse(base_url).netloc
        self.session_id = session_id
        self.max_depth = max_depth
        self.links_visitados = {base_url}
        self.total_links_encontrados = 0
        self.profundidade_maxima_atingida = 0
        self.pages_visited_since_restart = 0
        self.headless = headless
        self.logger = logging.LoggerAdapter(logging.getLogger(), {'session_id': self.session_id})
        self._start_driver()

    def _start_driver(self):
        try:
            chrome_options = Options()
            if self.headless:
                chrome_options.add_argument("--headless")
            chrome_options.add_argument("--start-maximized")
            chrome_options.add_argument("--disable-gpu")
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-setuid-sandbox")
            chrome_options.add_argument("--disable-accelerated-2d-canvas")
            chrome_options.add_argument("--disable-gl-drawing-for-tests")
            chrome_options.add_argument("--disable-software-rasterizer")
            chrome_options.add_argument("--remote-debugging-port=9222")
            chrome_options.add_argument("--window-size=1920,1080")
            chrome_options.add_argument("--disable-dev-shm-usage")
            chrome_options.add_argument("--disable-features=VizDisplayCompositor")
            chrome_options.add_argument("--disable-gpu-sandbox")
            prefs = {"profile.managed_default_content_settings.images": 2}
            chrome_options.add_experimental_option("prefs", prefs)
            self.driver = webdriver.Chrome(options=chrome_options)
            self.driver.set_page_load_timeout(45)
            self.wait = WebDriverWait(self.driver, 10)
        except Exception as e:
            self.logger.critical(f"ERRO CRÍTICO AO INICIAR O WEBDRIVER: {e}", exc_info=True)
            raise

    def _restart_driver(self):
        self.logger.info("Reiniciando o driver do Selenium para limpar recursos...")
        try:
            self.driver.quit()
        except Exception:
            pass
        self._start_driver()
        self.pages_visited_since_restart = 0
        self.logger.info("Driver reiniciado com sucesso.")

    def classificar_link(self, link):
        if not link or link.startswith(('#', 'javascript:', 'mailto:', 'tel:')): return 'IGNORAR'
        if any(link.lower().split('?')[0].endswith(ext) for ext in
               ['.pdf', '.xls', '.xlsx', '.doc', '.docx', '.zip', '.rar', '.csv', '.jpg', '.png',
                '.gif']): return 'DOWNLOAD'
        link_domain = urlparse(link).netloc
        if self.base_domain == link_domain:
            return 'INTERNO'
        else:
            return 'EXTERNO'

    def worker_verificador(self, q):
        while True:
            link_url = q.get()
            if link_url is None:
                break
            self.logger.info(f"Trabalhador verificando: {link_url}")
            verificacao = verificar_link_status(link_url)
            atualizar_status_link_api(link_url, self.session_id, verificacao["status"],
                                      http_code=verificacao["httpCode"], final_url=verificacao["finalUrl"])
            q.task_done()

    def iniciar(self):
        q = Queue()
        threads = []
        num_workers = 15
        for _ in range(num_workers):
            worker = Thread(target=self.worker_verificador, args=(q,))
            worker.daemon = True
            worker.start()
            threads.append(worker)

        queue_navegacao = deque([(self.base_url, 'INICIAL', 0)])

        try:
            while queue_navegacao:
                if self.pages_visited_since_restart >= 200:
                    self._restart_driver()
                self.pages_visited_since_restart += 1

                url_atual, origem, profundidade_atual = queue_navegacao.popleft()
                self.profundidade_maxima_atingida = max(self.profundidade_maxima_atingida, profundidade_atual)

                try:
                    self.driver.get(url_atual)
                    self.wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                    time.sleep(1.45)

                    page_content = self.driver.page_source.lower()
                    current_url = self.driver.current_url

                    if origem != 'INICIAL':
                        if is_error_page(page_content, current_url):
                            atualizar_status_link_api(url_atual, self.session_id, "Erro (página não encontrada)",
                                                      http_code=404, final_url=current_url)
                        else:
                            atualizar_status_link_api(url_atual, self.session_id, "Funcionando",
                                                      final_url=current_url)

                except (WebDriverException, TimeoutException) as e:
                    self.logger.error(f"Não foi possível carregar a página interna {url_atual}: {e}")

                    if origem != 'INICIAL':
                        atualizar_status_link_api(url_atual, self.session_id, "Timeout")
                    continue

                if profundidade_atual >= self.max_depth:
                    continue

                links_nesta_pagina = set()
                try:
                    last_height = self.driver.execute_script("return document.body.scrollHeight")
                    while True:
                        elementos = self.driver.find_elements(By.TAG_NAME, 'a')
                        for elemento in elementos:
                            href = elemento.get_attribute('href')
                            if href: links_nesta_pagina.add(href)
                        self.driver.execute_script("window.scrollBy(0, window.innerHeight);")
                        time.sleep(1.45)
                        new_height = self.driver.execute_script("return document.body.scrollHeight")
                        if new_height == last_height: break
                        last_height = new_height
                except Exception as e:
                    self.logger.error(f"Erro na coleta em {url_atual}: {e}")

                for link_href in links_nesta_pagina:
                    if link_href in self.links_visitados: continue
                    self.links_visitados.add(link_href)
                    self.total_links_encontrados += 1
                    tipo = self.classificar_link(link_href)
                    if tipo == 'IGNORAR': continue

                    link_data = {"url": link_href, "tipo": tipo, "origem": url_atual,
                                 "profundidade": profundidade_atual + 1}

                    if tipo == 'INTERNO':
                        queue_navegacao.append((link_href, url_atual, profundidade_atual + 1))
                        link_data['status'] = "Na fila"
                        enviar_link_api(link_data, self.session_id)
                    else:
                        link_data['status'] = "Não verificado"
                        enviar_link_api(link_data, self.session_id)
                        q.put(link_href)

            self.logger.info("Navegação concluída. Aguardando a equipe de verificação finalizar...")
            q.join()
            for _ in range(num_workers):
                q.put(None)
            for t in threads:
                t.join()

            self.logger.info("Verificação finalizada.")
            atualizar_sessao_api(self.session_id, "finalizado", self.total_links_encontrados,
                                 self.profundidade_maxima_atingida)

        except Exception as e:
            self.logger.critical(f"Erro crítico durante a varredura: {e}", exc_info=True)
            error_text = str(e)
            atualizar_sessao_api(self.session_id, "erro", self.total_links_encontrados,
                                 self.profundidade_maxima_atingida, error_message=error_text)

        finally:
            if hasattr(self, 'driver') and self.driver.session_id:
                try:
                    self.driver.quit()
                except Exception:
                    pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scanner unificado de links.")
    parser.add_argument("url", help="A URL base para iniciar a varredura.")
    parser.add_argument("--session-id", required=True, help="O ID da sessão para agrupar os resultados.")
    parser.add_argument("--depth", type=int, default=5, help="A profundidade máxima da varredura.")
    args = parser.parse_args()
    try:
        scanner = Scanner(base_url=args.url, session_id=args.session_id, max_depth=args.depth, headless=True)
        scanner.iniciar()
    except Exception as e:
        logging.critical(f"Script finalizado por exceção: {e}", extra={'session_id': args.session_id})