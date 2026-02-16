const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando a semeadura do banco de dados...');

  await prisma.evidencia.deleteMany({});
  await prisma.linkAnalista.deleteMany({});
  await prisma.linkAnaliseFinal.deleteMany({});
  await prisma.resposta.deleteMany({});
  await prisma.avaliacao.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.requisito.deleteMany({});
  await prisma.secretaria.deleteMany({});
  await prisma.scanSession.deleteMany({});
  await prisma.link.deleteMany({});
  await prisma.codigoVerificacao.deleteMany({});
  
  console.log('Dados antigos apagados.');

  await prisma.secretaria.createMany({
    data: [
      { nome: 'Agência de Defesa e Fiscalização Agropecuária de Pernambuco', sigla: 'ADAGRO', url: 'https://www.adagro.pe.gov.br' },
      { nome: 'Agência de Regulação dos Serviços Públicos Delegados do Estado de Pernambuco', sigla: 'ARPE', url: 'http://www.arpe.pe.gov.br' },
      { nome: 'Agência Estadual de Meio Ambiente', sigla: 'CPRH', url: 'https://www2.cprh.pe.gov.br' },
      { nome: 'Agência Estadual de Planejamento e Pesquisas de Pernambuco', sigla: 'CONDEPE/FIDEM', url: 'https://www.condepefidem.pe.gov.br/site/SiteCondepe/Pag/index.php' },
      { nome: 'Agência Estadual de Tecnologia da Informação', sigla: 'ATI', url: 'https://www.ati.pe.gov.br' },
      { nome: 'Agência Pernambucana de Águas e Clima', sigla: 'APAC', url: 'https://www.apac.pe.gov.br' },
      { nome: 'Casa Militar', sigla: 'CAMIL', url: 'https://www.camil.pe.gov.br' },
      { nome: 'Companhia Estadual de Habitação e Obras', sigla: 'CEHAB', url: 'https://www.cehab.pe.gov.br' },
      { nome: 'Consórcio de Transportes da Região Metropolitana do Recife', sigla: 'CTM', url: 'https://www.granderecife.pe.gov.br' },
      { nome: 'Corpo de Bombeiros', sigla: 'CBMPE', url: 'https://www.bombeiros.pe.gov.br' },
      { nome: 'Departamento de Estradas de Rodagem do Estado de Pernambuco', sigla: 'DER', url: 'https://www.der.pe.gov.br' },
      { nome: 'Departamento Estadual de Trânsito de Pernambuco', sigla: 'DETRAN', url: 'https://www.detran.pe.gov.br' },
      { nome: 'Distrito Estadual de Fernando de Noronha', sigla: 'DEFN', url: 'https://www.noronha.pe.gov.br' },
      { nome: 'Empresa de Turismo de Pernambuco Governador Eduardo Campos', sigla: 'EMPETUR', url: 'https://www.empetur.pe.gov.br' },
      { nome: 'Empresa Pernambuco de Comunicação S/A', sigla: 'EPC', url: 'https://www.epc.pe.gov.br' },
      { nome: 'Empresa Pernambucana de Transporte Intermunicipal', sigla: 'EPTI', url: 'https://www.epti.pe.gov.br' },
      { nome: 'Fundação de Amparo à Ciência e Tecnologia', sigla: 'FACEPE', url: 'https://www.facepe.br' },
      { nome: 'Fundação de Aposentadorias e Pensões dos Servidores do Estado de Pernambuco', sigla: 'FUNAPE', url: 'https://www.funape.pe.gov.br' },
      { nome: 'Fundação de Atendimento Socioeducativo', sigla: 'FUNASE', url: 'https://www.funase.pe.gov.br' },
      { nome: 'Fundação de Hematologia e Hemoterapia de Pernambuco', sigla: 'HEMOPE', url: 'https://www.hemope.pe.gov.br' },
      { nome: 'Fundação do Patrimônio Histórico e Artístico de Pernambuco', sigla: 'FUNDARPE', url: 'https://www.cultura.pe.gov.br/fundarpe' },
      { nome: 'Instituto Agronômico de Pernambuco', sigla: 'IPA', url: 'http://site.ipa.br' },
      { nome: 'Instituto de Atenção à Saúde e Bem-estar dos Servidores do Estado de Pernambuco', sigla: 'IASSEPE', url: 'https://www.iassepe.pe.gov.br' },
      { nome: 'Instituto de Pesos e Medidas do Estado de Pernambuco', sigla: 'IPEM', url: 'http://www.ipem.pe.gov.br' },
      { nome: 'Junta Comercial do Estado de Pernambuco', sigla: 'JUCEPE', url: 'https://portal.jucepe.pe.gov.br' },
      { nome: 'Pernambuco Participações e Investimentos S/A', sigla: 'PERPART', url: 'https://www.perpart.pe.gov.br' },
      { nome: 'Polícia Civil de Pernambuco', sigla: 'PCPE', url: 'https://www2.pc.pe.gov.br' },
      { nome: 'Polícia Militar de Pernambuco', sigla: 'PMPE', url: 'https://www.pm.pe.gov.br' },
      { nome: 'Procuradoria Geral do Estado', sigla: 'PGE', url: 'https://www.pge.pe.gov.br' },
      { nome: 'Programa de Orientação e Proteção ao Consumidor', sigla: 'PROCON', url: 'https://www.procon.pe.gov.br' },
      { nome: 'Secretaria da Assessoria Especial à Governadora e Relações Internacionais', sigla: 'SAESPRI', url: 'https://www.pe.gov.br/saespri' },
      { nome: 'Secretaria da Casa Civil', sigla: 'CASA CIVIL', url: 'https://www.casacivil.pe.gov.br' }, 
      { nome: 'Secretaria da Controladoria-Geral do Estado', sigla: 'SCGE', url: 'https://www.scge.pe.gov.br/' }, 
      { nome: 'Secretaria da Fazenda', sigla: 'SEFAZ', url: 'https://www.sefaz.pe.gov.br' },
      { nome: 'Secretaria da Mulher', sigla: 'SECMULHER', url: 'https://www.secmulher.pe.gov.br' },
      { nome: 'Secretaria de Administração', sigla: 'SAD', url: 'https://www.sad.pe.gov.br' },
      { nome: 'Secretaria de Administração Penitenciária e Ressocialização', sigla: 'SEAP', url: 'https://www.seap.pe.gov.br' },
      { nome: 'Secretaria de Assistência Social, Combate à Fome e Políticas sobre Drogas', sigla: 'SAS', url: 'https://www.sas.pe.gov.br' },
      { nome: 'Secretaria de Ciência, Tecnologia e Inovação', sigla: 'SECTI', url: 'https://www.secti.pe.gov.br' },
      { nome: 'Secretaria de Cultura', sigla: 'SECULT', url: 'https://www.cultura.pe.gov.br' },
      { nome: 'Secretaria de Defesa Social', sigla: 'SDS', url: 'https://www.sds.pe.gov.br' },
      { nome: 'Secretaria de Desenvolvimento Agrário, Agricultura, Pecuária e Pesca', sigla: 'SDA', url: 'http://agricultura.pe.gov.br' },
      { nome: 'Secretaria de Desenvolvimento Econômico', sigla: 'SDEC', url: 'https://www.sdec.pe.gov.br' },
      { nome: 'Secretaria de Desenvolvimento Profissional e Empreendedorismo', sigla: 'SEDEPE', url: 'https://www.sedepe.pe.gov.br' },
      { nome: 'Secretaria de Desenvolvimento Urbano e Habitação', sigla: 'SEDUH', url: 'https://seduh.pe.gov.br' },
      { nome: 'Secretaria de Educação e Esportes', sigla: 'SEE', url: 'https://portal.educacao.pe.gov.br' },
      { nome: 'Secretaria de Justiça, Direitos Humanos e Prevenção à Violência', sigla: 'SJDHPV', url: 'https://www.sjdh.pe.gov.br' },
      { nome: 'Secretaria de Meio Ambiente, Sustentabilidade e de Fernando de Noronha', sigla: 'SEMAS', url: 'https://semas.pe.gov.br' },
      { nome: 'Secretaria de Mobilidade e Infraestrutura', sigla: 'SEMOBI', url: 'https://www.semobi.pe.gov.br' },
      { nome: 'Secretaria de Planejamento, Gestão e Desenvolvimento Regional', sigla: 'SEPLAG', url: 'https://www.seplag.pe.gov.br' },
      { nome: 'Secretaria de Projetos Estratégicos', sigla: 'SEPE', url: 'https://www.pe.gov.br/sepe' },
      { nome: 'Secretaria de Recursos Hídricos e de Saneamento', sigla: 'SRHS', url: 'https://srhs.pe.gov.br' },
      { nome: 'Secretaria de Saúde', sigla: 'SES', url: 'https://portal.saude.pe.gov.br' },
      { nome: 'Secretaria de Turismo e Lazer', sigla: 'SETUR', url: 'https://www.setur.pe.gov.br' },
      { nome: 'Instituto de Terras e Reforma Agrária do Estado de Pernambuco', sigla: 'ITERPE', url: 'http://www.iterpe.pe.gov.br' }, 
      { nome: 'Universidade de Pernambuco', sigla: 'UPE', url: 'https://www.upe.br' },
      { nome: 'Vice-Governadoria', sigla: 'VICEGAB', url: 'https://www.pe.gov.br/gabvice' },
    ]
  });
  console.log('Lista de secretarias criada com sucesso.');

  await prisma.requisito.createMany({
    data: [
      { texto: "REQUISITO 01 - O órgão/entidade possui o mapeamento do processo de disponibilização e publicação das informações no sítio institucional?", textoAjuda: "O órgão/entidade deve realizar o mapeamento do processo de atualização das informações na seção Transparência do seu sítio institucional.", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 02 - O órgão ou entidade possui unidade de  controle interno (UCI) conforme diretrizes estabelecidas no Decreto Estadual 47.087/2019?", textoAjuda: "Os setores responsáveis pela produção, atualização e disponibilização das informações devem realizar as atividades dentro do prazo estabelecido.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 03 - O órgão/entidade elabora planos de capacitação e desenvolvimento, conforme estabelecido pela SCGE, sobre os temas relacionados à Transparência?", textoAjuda: "O setor responsável pela publicação dos dados e informações na seção Transparência deve realizar a atividade dentro do prazo estabelecido no mapeamento do processo.", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 04 - O órgão/entidade possui sítio institucional na internet?", textoAjuda: "Este requisito é pré-requisito para todos os demais. A avaliação é considerada concluída com pontuação 0 (zero) caso não seja atendido.", pontuacao: 4, linkFixo: 'KEYWORD:site-exists' },
      { texto: "REQUISITO 05 - Consta o menu \"Transparência\" no menu principal do sítio institucional do órgão/entidade?", textoAjuda: "Disponibilizar, na página inicial, o menu principal \"Transparência\" que dará acesso à seção \"Transparência\".", pontuacao: 4, linkFixo: 'KEYWORD:transparencia' },
      { texto: "REQUISITO 06 - Consta a seção \"Transparência\" no sítio institucional do órgão/entidade, de acordo com a estrutura estabelecida no Guia de Transparência Ativa do Poder Executivo Estadual?", textoAjuda: "Apresentar a seção \"Transparência\", conforme instruções dispostas no Guia.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 07 - O órgão/entidade identifica as 10 páginas mais acessadas do seu sítio institucional?", textoAjuda: "Lembrar de Alterar a pontuação e o texto de ajuda", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 08 - Consta ferramenta de pesquisa de conteúdo no sítio institucional do órgão/entidade, que permita o acesso à informação de forma objetiva, transparente, clara e em linguagem de fácil compreensão?", textoAjuda: "Em regra, essa ferramenta é encontrada na parte superior do sítio, sinalizada com uma lupa ou campo de texto.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 09 - Consta o menu \"Fale conosco\" no menu principal do sítio institucional do órgão/entidade?", textoAjuda: "Disponibilizar no menu principal o menu \"Fale conosco\" que dará acesso à seção com instruções que permitam ao usuário comunicar-se com o órgão ou a entidade.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 10 - O site  contém exibição do “caminho” de páginas percorridas pelo usuário?", textoAjuda: "Lembrar de mudar a Pontuação e o texto de ajuda", pontuacao: 3, linkFixo: null },
      { texto: "REQUISITO 11 - O site e o portal de transparência contêm opção de alto contraste?", textoAjuda: "Lembrar de mudar a pontuação e o texto de ajuda", pontuacao: 3, linkFixo: null },
      { texto: "REQUISITO 12 - O site e o portal de transparência contêm ferramenta de redimensionamento de texto?", textoAjuda: "Lembrar de mudar a pontuação e o texto de ajuda", pontuacao: 3, linkFixo: null },
      { texto: "REQUISITO 13 - Contém mapa do site institucional?", textoAjuda: "Lembrar de mudar a pontuação e o texto de ajuda", pontuacao: 3, linkFixo: null },
      { texto: "REQUISITO 14 - Informa como se encontra na atual estrutura do Poder Executivo?", textoAjuda: "Disponibilizar informações sobre como o órgão/entidade se encontra na atual estrutura do Poder Executivo Estadual, juntamente, com o link de acesso à lei estadual que regulamenta a atual estrutura.", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 15 - Disponibiliza o horário de funcionamento, o endereço, o e-mail e o telefone de contato da sede do órgão/entidade e das unidades descentralizadas, se houver?", textoAjuda: "Disponibilizar horário, endereço, e-mail e telefone de contato da sede e unidades.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 16 - Apresenta o mapa estratégico ou a visão, a missão e os valores atuais do órgão/entidade?", textoAjuda: "Apresentar o mapa estratégico ou a visão, a missão e os valores atuais do órgão/entidade.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 17 - Divulga agenda do(a) Secretário(a)/Autoridade máxima da Secretaria, com periodicidade diária?", textoAjuda: "Lembrar de mudar o texto de ajuda", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 18 - Divulga o currículo do(a) Secretário(a)/Autoridade máxima da Secretaria?", textoAjuda: "Lembrar de mudar o texto de ajuda", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 19 - Disponibiliza o organograma atualizado do órgão/entidade?", textoAjuda: "Divulgar o organograma com imagens e fontes legíveis. Caso apresente siglas, colocar os seus respectivos significados.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 20 - Disponibiliza o nome e os contatos (telefone e e-mail) dos ocupantes dos principais cargos do órgão/entidade?", textoAjuda: "Disponibilizar o nome e contatos dos ocupantes dos principais cargos do órgão/entidade.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 21 - Divulga as competências e/ou atribuições do órgão/entidade?", textoAjuda: "O registro das competências pode constar em alguma legislação, sendo permitido o redirecionamento para o local exato.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 22 - Disponibiliza o acesso à relação das legislações aplicáveis ao órgão/entidade, bem como aos atos normativos próprios?", textoAjuda: "Disponibilizar acesso à relação das legislações aplicáveis ao órgão/entidade.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 23 - Disponibiliza o Plano de Cargos e Carreira dos servidores efetivos do órgão/entidade?", textoAjuda: "Caso possua Plano de Cargos e Carreira, basta disponibilizar a legislação pertinente.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 24 - Disponibiliza o acesso ao Código de Ética da Administração Pública Estadual?", textoAjuda: "Disponibilizar o acesso ao Código de Ética da Administração Pública Estadual (Lei nº 16.309/2018).", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 25 - Disponibiliza o acesso a pelo menos um dos documentos a seguir: Código de Ética ou de Conduta, Informações da Comissão de Ética ou Plano de Integridade.", textoAjuda: "Disponibilizar acesso a pelo menos um dos documentos listados.", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 26 - Disponibiliza link de acesso à \"Carta de Serviços ao Usuário do órgão/entidade\" no Portal PE.GOV?", textoAjuda: "O link deve direcionar para o local específico onde a Carta de Serviços está divulgada no Portal PE Cidadão.", pontuacao: 4, linkFixo: 'https://pecidadao.pe.gov.br/' },
      { texto: "REQUISITO 27 - Disponibiliza informações sobre os conselhos ativos no órgão/entidade, incluindo: legislação de criação, lista de membros, atas das reuniões e calendário de encontros.", textoAjuda: "Disponibilizar informações sobre os conselhos ativos no órgão/entidade.", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 28 - Disponibiliza o nome e os contatos do encarregado pelo tratamento de dados pessoais, bem como a Política de Privacidade e Proteção de Dados Pessoais?", textoAjuda: "Disponibilizar nome e contatos do encarregado e a Política de Privacidade e Proteção de Dados Pessoais.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 29 - Disponibiliza link de acesso à conta ativa do órgão/entidade em alguma rede social?", textoAjuda: "O link deve direcionar para o perfil do órgão ou entidade na(s) rede(s) social(is) - Como Facebook, Twitter, Instagram, Youtube, Tik Tok, Flickr, entre outras.", pontuacao: 2, linkFixo: 'KEYWORD:social-media' },
      { texto: "REQUISITO 30 - Divulga no mínimo 10 (dez) perguntas e respostas mais frequentes da sociedade sobre as atividades desenvolvidas pelo órgão/entidade?", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 31 - Disponibiliza os links de acesso às seções 'Responsabilidade Fiscal', 'Ouvidoria', 'Fiscalização e Controle', 'Transferências', 'Receitas', 'Despesas', 'Obras', 'Patrimônio Público', 'Recursos Humanos', 'Licitações e Contratos', 'Acesso à Informação', 'Dados Abertos' e 'Participação' no Portal da Transparência de Pernambuco?", pontuacao: 8, linkFixo: null },
      
      { texto: "REQUISITO 32.1 - Disponibiliza os contratos no (Mapa de Contratos ou no módulo de contratos do PE Integrado) do órgão/entidade referente ao ano vigente?", textoAjuda: "O Mapa de \"Contratos\" deverá ser atualizado mensalmente e publicado até o 10º dia útil do mês subsequente.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 32.2 - Disponibiliza os Mapas de Contratos do órgão/entidade dos 03 (três) anos antecedentes ao ano atual?", textoAjuda: "Faz referência a série histórica solicitada aos órgãos no guia da transparência", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 33.1 - Disponibiliza o Mapa de Contratos de Terceirizados do órgão/entidade do ano vigente?", textoAjuda: "Faz referência a série histórica solicitada aos órgãos no guia da transparência", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 33.2 - Disponibiliza os Mapas de Contratos de Terceirizados do órgão/entidade dos 03 (três) anos antecedentes ao atual?", textoAjuda: "Faz referência a série histórica solicitada aos órgãos no guia da transparência", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 34.1 - Disponibiliza o Mapa de Diárias e Passagens dentro do Estado, fora do Estado e fora do país, conforme legislação local, do órgão/entidade do ano vigente? Com o nome e o cargo/função do beneficiário, além do número de diárias usufruídas por afastamento, período de afastamento, motivo do afastamento e local de destino?", textoAjuda: "O Mapa de \"Diárias e Passagens\" deverá ser atualizado mensalmente e publicado até o 10º dia útil do mês subsequente.", pontuacao: 4, linkFixo: null },
      { texto: "REQUISITO 34.2 - Disponibiliza os Mapas de Diárias e Passagens do órgão/entidade dos 03 (três) anos antecedentes ao atual?", textoAjuda: "Faz referência a série histórica solicitada aos órgãos no guia da transparência", pontuacao: 2, linkFixo: null },
      { texto: "REQUISITO 35 - Publica anualmente informações sobre doações e/ou comodatos recebidos (como na pandemia, em catástrofes ou por empresas), sejam em dinheiro ou bens materiais, na seção Transparência do sítio institucional do órgão/entidade?", textoAjuda: "", pontuacao: 2, linkFixo: null },
 
      
      { texto: "REQUISITO 28 - Disponibiliza link de acesso à seção \"Ouvidoria\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Ouvidoria\" do Portal da Transparência.", pontuacao: 4, linkFixo: 'https://transparencia.pe.gov.br/participacao-cidada-pe/ouvidoria/' }, 
      { texto: "REQUISITO 31 - Disponibiliza link de acesso à seção \"Responsabilidade Fiscal\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Responsabilidade Fiscal\" do Portal da Transparência.", pontuacao: 8, linkFixo: 'https://transparencia.pe.gov.br/responsabilidade-fiscal/' },
      { texto: "REQUISITO 32 - Disponibiliza link de acesso à seção \"Fiscalização e Controle\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Fiscalização e Controle\" do Portal da Transparência.", pontuacao: 4, linkFixo: 'https://transparencia.pe.gov.br/gestao-estadual/fiscalizacao-e-controle/' },
      { texto: "REQUISITO 33 - Disponibiliza link de acesso à seção \"Transferências\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Transferências\" do Portal da Transparência.", pontuacao: 2, linkFixo: 'https://transparencia.pe.gov.br/despesas/transferencias/' },
      { texto: "REQUISITO 34 - Disponibiliza link de acesso à seção \"Receitas\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Receitas\" do Portal da Transparência.", pontuacao: 8, linkFixo: 'https://transparencia.pe.gov.br/receitas/' },
      { texto: "REQUISITO 35 - Disponibiliza link de acesso à seção \"Despesas\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Despesas\" do Portal da Transparência.", pontuacao: 8, linkFixo: 'https://transparencia.pe.gov.br/despesas/menu-despesas/' },
      { texto: "REQUISITO 36 - Disponibiliza link de acesso à seção \"Licitações e Contratos\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Licitações, Contratos e Fornecedores\" do Portal da Transparência.", pontuacao: 6, linkFixo: 'https://transparencia.pe.gov.br/licitacoes-e-contratos/' },    
      { texto: "REQUISITO 39 - Disponibiliza link de acesso à seção \"Obras\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Obras\" do Portal da Transparência.", pontuacao: 2, linkFixo: 'https://transparencia.pe.gov.br/despesas/obras/' },
      { texto: "REQUISITO 40 - Disponibiliza link de acesso à seção \"Patrimônio Público\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Patrimônio Público\" do Portal da Transparência.", pontuacao: 1, linkFixo: 'https://transparencia.pe.gov.br/gestao-estadual/patrimonio-publico/' },
      { texto: "REQUISITO 41 - Disponibiliza link de acesso à seção \"Recursos Humanos\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Recursos Humanos\" do Portal da Transparência.", pontuacao: 6, linkFixo: 'https://transparencia.pe.gov.br/recursos-humanos/' },   
      { texto: "REQUISITO 43 - Disponibiliza link de acesso à seção \"Acesso à Informação\" do Portal da Transparência de Pernambuco?", textoAjuda: "Disponibilizar link de acesso à seção \"Acesso à Informação\" do Portal da Transparência.", pontuacao: 4, linkFixo: 'https://transparencia.pe.gov.br/participacao-cidada-pe/acesso-a-informacao/' },
    ],
  });
  console.log('Novos requisitos criados com sucesso.');
  console.log('Criando usuários de exemplo...');

  const usersData = [
    {
      email: 'kadsonlima91@gmail.com',
      password: 'kadsonlima1234', 
      nome: 'Administrador',
      secretariaSigla: 'SCGE',
      role: 'ADMIN' 
    },
    {
      email: 'luiz.f-neto@cge.pe.gov.br',
      password: 'luiz.f-neto1234', 
      nome: 'Administrador',
      secretariaSigla: 'SCGE',
      role: 'ADMIN' 
    },
    {
      email: 'roberta.gomes@scge.pe.gov.br',
      password: 'roberta.gomes1234', 
      nome: 'Administrador',
      secretariaSigla: 'SCGE',
      role: 'ADMIN' 
    },
    {
      email: 'scge@exemplo.com',
      password: 'senha_scge',
      nome: 'Usuário SCGE',
      secretariaSigla: 'SCGE',
      role: 'SECRETARIA' 
    },
    {
      email: 'secti@exemplo.com',
      password: 'senha_secti',
      nome: 'Usuário SECTI',
      secretariaSigla: 'SECTI',
      role: 'SECRETARIA' 
    },
    {
      email: 'sad@exemplo.com',
      password: 'senha_sad',
      nome: 'Usuário SAD',
      secretariaSigla: 'SAD',
      role: 'SECRETARIA'
    }
  ];

  for (const u of usersData) {
    const secretaria = await prisma.secretaria.findUnique({
      where: { sigla: u.secretariaSigla },
    });

    if (!secretaria) {
      console.warn(`Secretaria com sigla ${u.secretariaSigla} não encontrada. Pulando usuário ${u.email}.`);
      continue;
    }

    const hashedPassword = bcrypt.hashSync(u.password, 10); 
    
    await prisma.user.create({
      data: {
        email: u.email,
        password: hashedPassword,
        nome: u.nome,
        role: u.role || 'SECRETARIA', 
        secretariaId: secretaria.id,
      },
    });
  }
  console.log(`${usersData.length} novos usuários criados com sucesso.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });