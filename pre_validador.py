import time
import random
import logging
import argparse
import json
import tempfile
import os
from urllib.parse import urlparse, urljoin
from collections import deque
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import WebDriverException, TimeoutException

logging.basicConfig(filename='pre_validador.log', level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')


class PreValidador:
    def __init__(self, base_url):
        self.base_url = base_url
        self.base_domain = urlparse(base_url).netloc
        self.logger = logging.getLogger(__name__)
        

        self.user_data_dir = tempfile.mkdtemp()
        
        try:
            chrome_options = Options()
            chrome_options.add_argument("--headless")
            chrome_options.add_argument("--start-maximized")
            chrome_options.add_argument("--disable-gpu")
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")

            chrome_options.add_argument(f"--user-data-dir={self.user_data_dir}")
            
            self.driver = webdriver.Chrome(options=chrome_options)
            self.driver.set_page_load_timeout(45)
        except Exception as e:
            self.logger.critical(f"ERRO CRÍTICO AO INICIAR O WEBDRIVER: {e}", exc_info=True)
            raise

    def __del__(self):
        """Garantir que o driver seja fechado quando o objeto for destruído"""
        try:
            if hasattr(self, 'driver'):
                self.driver.quit()
            if hasattr(self, 'user_data_dir') and os.path.exists(self.user_data_dir):
                import shutil
                shutil.rmtree(self.user_data_dir, ignore_errors=True)
        except:
            pass

    def buscar_links_alvo(self, links_alvo):
        resultados_encontrados = []
        alvos_ja_encontrados = set()
        queue = deque([(self.base_url, 0)])
        visitados = {self.base_url}
        max_depth_busca = 2

        self.logger.info(f"Iniciando busca por {len(links_alvo)} alvos em {self.base_url}")

        try:
            while queue:
                if len(alvos_ja_encontrados) == len(links_alvo):
                    self.logger.info("Todos os links alvo foram encontrados. Encerrando a busca.")
                    break

                url_atual, profundidade_atual = queue.popleft()
                if profundidade_atual >= max_depth_busca:
                    continue

                try:
                    self.driver.get(url_atual)
                    time.sleep(random.uniform(2, 4))
                except (WebDriverException, TimeoutException):
                    self.logger.warning(f"Não foi possível carregar a página {url_atual}.")
                    continue

                links_na_pagina = self.driver.find_elements(By.TAG_NAME, 'a')
                for link in links_na_pagina:
                    href = link.get_attribute('href')
                    texto_do_link = link.text.lower()
                    if not href:
                        continue

                    href_absoluto = urljoin(self.base_url, href)

                    for alvo in links_alvo:
                        if alvo in alvos_ja_encontrados:
                            continue

                        encontrou_no_href = alvo in href_absoluto

                        palavras_chave_texto = alvo.split('/')[-2].replace('-', ' ') if '/' in alvo else ""
                        encontrou_no_texto = palavras_chave_texto in texto_do_link if palavras_chave_texto else False

                        if encontrou_no_href or encontrou_no_texto:
                            resultados_encontrados.append({"alvo": alvo, "origem": url_atual})
                            alvos_ja_encontrados.add(alvo)
                            self.logger.info(f"Alvo '{alvo}' encontrado em: {url_atual}")
                            break

                    if self.base_domain in href_absoluto and href_absoluto not in visitados:
                        visitados.add(href_absoluto)
                        queue.append((href_absoluto, profundidade_atual + 1))
        finally:
            self.driver.quit()
            if hasattr(self, 'user_data_dir') and os.path.exists(self.user_data_dir):
                import shutil
                shutil.rmtree(self.user_data_dir, ignore_errors=True)
        
        print(json.dumps(resultados_encontrados))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pré-validador de links para o formulário.")
    parser.add_argument("url", help="A URL base para iniciar a busca.")
    parser.add_argument("--find-links", required=True, help="Uma lista de URLs para encontrar, separadas por vírgula.")
    args = parser.parse_args()
    
    validador = None
    try:
        validador = PreValidador(base_url=args.url)
        links_alvo = args.find_links.split(',')
        validador.buscar_links_alvo(links_alvo)
    except Exception as e:
        logging.critical(f"Script de pré-validação finalizado por exceção: {e}")
    finally:
        if validador:
            # Já foi fechado no método, mas garantimos
            try:
                validador.driver.quit()
            except:
                pass