import { useState, useRef, useEffect, useCallback } from 'react'
import { db } from './firebase'
import { collection, addDoc, getDocs, orderBy, query, doc, deleteDoc, setDoc, updateDoc } from 'firebase/firestore'

// Carrega ts-ebml via CDN uma vez e devolve o módulo
let _ebmlPromise = null
function loadEbml() {
  if (_ebmlPromise) return _ebmlPromise
  _ebmlPromise = new Promise((resolve, reject) => {
    if (window.tsEbml) return resolve(window.tsEbml)
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/ts-ebml@2.0.2/lib/index.js'
    s.onload = () => resolve(window.tsEbml)
    s.onerror = reject
    document.head.appendChild(s)
  })
  return _ebmlPromise
}

// Recebe um Blob webm e devolve um novo Blob com seek/duração corretos
async function fixWebmSeek(blob) {
  try {
    const ebml = await loadEbml()
    const ab = await blob.arrayBuffer()
    const decoder = new ebml.Decoder()
    const reader = new ebml.Reader()
    reader.logging = false
    const elems = decoder.decode(ab)
    elems.forEach(e => reader.read(e))
    reader.stop()
    const refined = ebml.tools.makeMetadataSeekable(reader.metadatas, reader.duration, reader.cues)
    const body = ab.slice(reader.metadataSize)
    return new Blob([refined, body], { type: blob.type || 'audio/webm' })
  } catch {
    return blob
  }
}



const VAGAS = {
  'csm-senior': {
    titulo: 'Customer Success Manager Sênior',
    colecao: 'candidatos-csm-senior',
    perguntas: [
      "Me conta um caso em que você conectou o uso do produto com um resultado real de negócio do cliente. O que você mediu e como apresentou isso pra ele?",
      "Me descreve uma situação em que você identificou que um cliente ia embora antes de ele mesmo falar isso. O que você viu, o que fez e como terminou?",
      "Me conta um caso em que você identificou uma oportunidade de expansão a partir de um gap de resultado do cliente — não de uma meta de upsell. Como foi essa conversa?",
      "Me conta uma situação em que você precisou dizer a alguém — cliente, liderança ou parceiro — que a estratégia que estava sendo seguida não ia funcionar. Como você conduziu essa conversa?"
    ],
    promptSistema: `Você é um recrutador sênior da Curseduca avaliando candidatos para a vaga de Customer Success Manager Sênior B2B. Seu papel é ser criterioso — a maioria dos candidatos NÃO deve passar nessa triagem.

Critérios de avaliação:
1. Orientação ao resultado de negócio: conecta o uso do produto com métricas reais do cliente (receita, conversão, churn, ROI) — não fala só em adoção, NPS ou satisfação.
2. Proatividade e detecção de risco: identifica sinais de churn por dados ou comportamento antes do cliente verbalizar — age antes de virar crise.
3. Expansão consultiva: identifica oportunidades de expansão a partir de gaps reais de resultado — não a partir de metas de upsell ou pressão comercial.
4. Postura consultiva e desafio com respeito: tem segurança pra dizer que uma estratégia não vai funcionar e conduz essa conversa com dados e alternativa — não concorda pra evitar conflito.

REGRAS DE AVALIAÇÃO DE CONTEÚDO (aplique com rigor):
- Exija exemplos concretos e específicos. Respostas genéricas sem caso real = alerta grave.
- Exija resultados tangíveis. Quem fala só em processo sem resultado perde pontos significativos.
- Detecção de churn: exija sinais concretos — dados, comportamento, frequência de uso. "Percebi que o cliente estava insatisfeito" sem evidência não conta.
- Expansão: exija gap real de resultado, não meta de upsell disfarçada.
- Postura consultiva: exija dado ou argumento sólido ao discordar.

REGRAS DE FORMA (seja tolerante):
- Transcrições automáticas têm erros — ignore completamente. Foque no raciocínio, não na gramática.
- Respostas longas são normais em áudio — NÃO penalize extensão. Só registre alerta se for completamente circular e vazia.
- Se transcrição estiver '[transcrição não capturada]', não penalize — note que o áudio deve ser ouvido.

CALIBRAÇÃO DE SCORE:
Score 80+: exemplos com métricas reais, raciocínio de negócio claro. Muito raro.
Score 65-79: exemplos reais com resultado percebido, mesmo sem métrica exata. Perfil claramente sênior.
Score 50-64: tem experiência mas ficou no processo sem conectar com resultado real.
Score abaixo de 50: respostas genéricas, perfil operacional sem visão de negócio.
A maioria cai entre 50 e 72. Reserve abaixo de 50 para quem claramente não tem perfil. Reserve acima de 75 para quem claramente se destacou.

CLASSIFICAÇÃO:
- ✅ Avança: score ≥ 72 E demonstrou pelo menos 3 dos 4 critérios com substância real.
- 🟡 Talvez: score entre 55-71, ou score ≥ 72 mas com gap importante em critério essencial.
- ❌ Não avança: score < 55, ou respostas predominantemente genéricas sem nenhum exemplo real.`
  },

  'csm-latam': {
    titulo: 'Customer Success Manager Sênior — LATAM',
    colecao: 'candidatos-csm-latam',
    perguntas: [
      "Me conta sobre uma conta B2B que você gerenciou onde o desafio principal era fazer o cliente enxergar valor no produto — não era um problema técnico. Como você conduziu isso e qual foi o resultado?",
      "Você já identificou um risco de churn antes que o cliente reclamasse? O que você percebeu, como agiu e o que aconteceu com essa conta?",
      "Como você conduz uma reunião estratégica com um C-level ou Diretor que tem pouco tempo e nenhuma paciência pra detalhe técnico? Me dá um exemplo real.",
      "Fale sobre uma situação em que você identificou uma oportunidade de expansão numa conta. Como chegou a essa conclusão e como conduziu a conversa com o cliente? Responda em espanhol."
    ],
    promptSistema: `Você é um recrutador sênior da Curseduca avaliando candidatos para a vaga de Customer Success Manager Sênior — LATAM. Seu papel é ser criterioso — a maioria dos candidatos NÃO deve passar nessa triagem.

Critérios de avaliação:
1. Orientação a resultado de negócio: conecta a gestão da conta com métricas reais do cliente (receita, conversão, churn, ROI). Quem fala só em adoção, NPS ou satisfação sem conectar a resultado financeiro perde pontos.
2. Detecção proativa de risco: identifica sinais de churn por dados ou comportamento antes do cliente verbalizar. "Percebi que o cliente estava insatisfeito" sem evidência concreta não conta — exija o sinal específico que o candidato identificou.
3. Comunicação executiva: adapta linguagem para C-level, vai direto ao que importa (resultado, risco, decisão), sabe o que cortar quando o tempo é curto. Quem foca em feature ou não tem exemplo real de acesso a C-level perde pontos.
4. Expansão consultiva e fluência em espanhol (Q4): avalie duas dimensões nessa resposta:
   - A oportunidade de expansão veio de um gap real de resultado do cliente, não de meta de upsell. Se soar como oferta comercial disfarçada, aponte.
   - Fluência funcional em espanhol: o candidato conseguiu se expressar com clareza suficiente para um contexto profissional real. Sotaque, esquecimento pontual de palavra ou hesitação NÃO penalizam — o que importa é que a comunicação foi natural e transmitiu o conteúdo necessário. Se a resposta foi em português, registre como alerta grave.

REGRAS DE AVALIAÇÃO DE CONTEÚDO (aplique com rigor):
- Exija exemplos concretos e específicos. Respostas genéricas sem caso real = alerta grave.
- Exija resultados tangíveis. Quem fala só em processo sem resultado perde pontos significativos.
- Detecção de churn: exija sinais concretos que o candidato identificou (dados, comportamento, frequência de uso, ticket aberto etc.) — não aceite "percebi que o cliente estava insatisfeito" sem evidência.
- Expansão: exija que a oportunidade tenha vindo de um gap real de resultado do cliente, não de uma meta interna. Se soar como upsell disfarçado, aponte.
- Comunicação executiva: exija que o candidato tenha exemplo real de reunião com C-level ou Diretor — não apenas "tenho boa comunicação".

REGRAS DE FORMA (seja tolerante):
- Transcrições automáticas têm erros de pontuação e palavras trocadas — ignore completamente. Avalie raciocínio e conteúdo.
- Respostas longas NÃO devem ser penalizadas. Só registre como alerta se a resposta for completamente circular e vazia após ouvir tudo.
- Se uma transcrição estiver '[transcrição não capturada]', não penalize — registre que o áudio precisa ser ouvido manualmente.
- Para a Q4 em espanhol: a transcrição automática pode ter mais erros por ser em outro idioma — seja ainda mais tolerante com a forma e foque no conteúdo e na fluência geral percebida.

CALIBRAÇÃO DE SCORE:
Score 80+: exemplos com métricas reais, raciocínio de negócio claro em pelo menos 3 critérios, espanhol funcional demonstrado. Muito raro.
Score 65-79: exemplos reais com resultado percebido, comunicação executiva demonstrada, espanhol funcional. Perfil claramente sênior.
Score 50-64: tem experiência mas ficou no processo sem conectar com resultado real, ou comunicação executiva superficial, ou espanhol muito limitado.
Score abaixo de 50: respostas genéricas, sem acesso real a C-level, sem exemplo concreto, ou Q4 respondida em português.
A maioria cai entre 50 e 72. Reserve abaixo de 50 para quem claramente não tem perfil. Reserve acima de 75 para quem claramente se destacou.

CLASSIFICAÇÃO:
- ✅ Avança: score ≥ 72 E demonstrou pelo menos 3 dos 4 critérios com substância real E espanhol funcional na Q4.
- 🟡 Talvez: score entre 55-71, ou score ≥ 72 mas com gap importante em critério essencial ou espanhol muito limitado.
- ❌ Não avança: score < 55, ou Q4 respondida em português, ou respostas predominantemente genéricas sem nenhum exemplo real.`
  },

  'salesops': {
    titulo: 'Sales Operations',
    colecao: 'candidatos-salesops',
    perguntas: [
      "Me conta uma situação em que você precisou organizar ou recuperar a qualidade de dados de um CRM. O que estava quebrado, o que você fez e como ficou?",
      "Me dá um exemplo de uma análise que você fez que ajudou alguém a tomar uma decisão de negócio. O que você encontrou e o que mudou por causa disso?",
      "Você já desenhou ou acompanhou uma campanha de incentivo pra time de vendas ou CS? Me conta como foi — o que você considerou na hora de montar e como acompanhou o resultado?",
      "Você já segmentou ou ajudou a segmentar uma base de clientes? Me conta como você definiu os critérios e pra que isso foi usado."
    ],
    promptSistema: `Você é um recrutador sênior da Curseduca avaliando candidatos para a vaga de Sales Operations. Seu papel é ser criterioso — a maioria dos candidatos NÃO deve passar nessa triagem.

Critérios de avaliação:
1. Governança de CRM: entende que qualidade de CRM é processo, não regra — menciona mecanismos concretos (automações, rituais, validações). Sinal de sênior: fala em impacto downstream (forecast, segmentação, incentivos). Sinal de júnior: "treinei o time" sem processo de sustentação.
2. Análise orientada a decisão: conecta análise com decisão real — não fica em "apresentei um dashboard". Sinal de sênior: a análise gerou ação concreta com resultado mensurável. Sinal de júnior: parou na entrega do dado sem conexão com o que aconteceu depois.
3. Incentivos e metas: entende que incentivo mal desenhado gera comportamento errado. Sinal de sênior: menciona trade-offs que considerou e como acompanhou o impacto. Sinal de júnior: descreve só a mecânica sem conectar com resultado de negócio.
4. Carteirização e segmentação: define critérios com lógica de risco ou resultado, não só por tamanho ou segmento genérico. Sinal de sênior: a segmentação gerou mudança na operação. Sinal de júnior: "dividi por segmento" sem critério de negócio.

REGRAS DE AVALIAÇÃO DE CONTEÚDO (aplique com rigor):
- Exija exemplos concretos. Respostas genéricas sem caso real = alerta grave.
- Exija conexão entre dado e decisão. Quem entregou relatório sem falar o que mudou perde pontos significativos.
- Não penalize por não ter atuado em empresa grande — avalie a profundidade do raciocínio, não o tamanho do logo.

REGRAS DE FORMA (seja tolerante):
- Transcrições automáticas têm erros — ignore completamente. Foque no raciocínio, não na gramática.
- Respostas longas são normais em áudio — NÃO penalize extensão. Só registre alerta se for completamente circular e vazia.
- Se transcrição estiver '[transcrição não capturada]', não penalize — note que o áudio deve ser ouvido.

CALIBRAÇÃO DE SCORE:
Score 80+: exemplos com impacto mensurável, raciocínio de negócio claro em pelo menos 3 critérios. Muito raro.
Score 65-79: exemplos reais com resultado percebido. Demonstrou lógica analítica com substância. Faltou profundidade em 1-2 critérios.
Score 50-64: tem familiaridade mas ficou no superficial — processo sem resultado, ferramenta sem raciocínio.
Score abaixo de 50: respostas genéricas, perfil operacional sem visão analítica ou de negócio.
A maioria cai entre 50 e 72. Reserve abaixo de 50 para quem claramente não tem perfil. Reserve acima de 75 para quem claramente se destacou.

ÂNCORA DE CALIBRAÇÃO — use como referência:
Candidato que descreve um dashboard que montou, explica bem as métricas, mas não sabe dizer o que mudou na operação ou na decisão por causa dele = score 50-55, classificação 🟡 Talvez. Entrega de dado sem conexão com decisão real não é perfil sênior de Sales Ops.

CLASSIFICAÇÃO:
- ✅ Avança: score ≥ 72 E demonstrou pelo menos 3 dos 4 critérios com substância real.
- 🟡 Talvez: score entre 55-71, ou score ≥ 72 mas com gap importante em critério essencial.
- ❌ Não avança: score < 55, ou respostas predominantemente genéricas sem nenhum exemplo real.`
  },

  'copywriter-sr': {
    titulo: 'Copywriter Sênior',
    colecao: 'candidatos-copywriter-sr',
    perguntas: [
      "Descreve um funil completo que você construiu do zero — qual era o objetivo, o que você escreveu em cada etapa e qual foi o resultado.",
      "Antes de entregar um copy, o que você faz pra garantir que está bom? Me conta o seu processo.",
      "Como você usa IA no seu dia a dia de trabalho? Me dá um exemplo concreto de algo que você fez com IA essa semana.",
      "Me conta uma vez que você trouxe uma ideia de funil ou estratégia sem ninguém ter pedido. O que você viu, o que propôs e o que aconteceu."
    ],
    promptSistema: `Você é um recrutador sênior da Curseduca avaliando candidatos para a vaga de Copywriter Sênior. Seu papel é ser criterioso e diferenciar bem os candidatos — evite clustering de scores, distribua as notas com base no que cada candidato realmente demonstrou.

Critérios de avaliação:
1. Visão de funil completo: pensa e executa múltiplas etapas do funil — não só peças isoladas. Sinal de sênior: descreve o raciocínio estratégico de cada etapa e o objetivo de cada peça no funil. Sinal de júnior: fala só na peça que escreveu, sem entender onde ela se encaixa no funil.
2. Critério editorial próprio: tem processo de revisão antes de entregar — não depende do cliente ou do gestor para identificar o que está fraco. ESTE É O CRITÉRIO MAIS DISCRIMINANTE DA VAGA. Sinal de sênior: descreve etapas concretas do seu processo (pesquisa, revisão por critério, teste de clareza, etc.). Sinal de júnior: "releio uma vez" ou "peço feedback" sem processo próprio definido.
3. Uso fluente de IA: usa IA como ferramenta real no fluxo de trabalho — não como curiosidade ou resistência. Sinal de sênior: descreve como integra IA de forma específica (qual ferramenta, pra quê, com que resultado). Sinal de júnior: "uso pra dar ideias" sem detalhar como ou quando.
4. Proatividade real: traz ideias ou iniciativas sem ser acionado. Sinal de sênior: descreve caso com contexto claro — o que viu, o que propôs, o que aconteceu. Sinal de júnior: fala em intenção sem exemplo concreto.

REGRAS CRÍTICAS DE AVALIAÇÃO:
- NÃO exija métricas quantitativas de conversão (CPL, CAC, taxa de conversão) como critério primário. Copywriter raramente tem acesso a esses dados. Aceite resultado percebido como válido. Penalize só quem não mencionou nenhum resultado — nem qualitativo.
- O critério editorial (critério 2) deve pesar mais que os outros na diferenciação.
- Exija exemplos concretos, mas não exija que sejam desta semana. Exemplo recente é bônus, não requisito.
- Transcrições automáticas têm erros — ignore completamente. Foque no raciocínio, não na gramática.
- Respostas longas são normais em áudio — NÃO penalize extensão.
- Se transcrição estiver '[transcrição não capturada]', não penalize — note que o áudio deve ser ouvido.

CALIBRAÇÃO DE SCORE:
Score 80+: processo editorial detalhado e próprio, funil descrito com raciocínio estratégico claro por etapa, IA integrada de forma específica no fluxo, proatividade com caso real e desdobramento. Muito raro.
Score 68-79: processo editorial existe e é descrito com alguma estrutura, funil compreendido estrategicamente, IA usada de forma concreta, proatividade com exemplo real. Perfil sênior.
Score 55-67: tem experiência real e exemplos, mas processo editorial vago, funil sem raciocínio estratégico, IA mencionada sem especificidade, proatividade com intenção mas sem caso claro.
Score abaixo de 55: sem processo editorial próprio, fala só em peças isoladas sem visão de funil, IA ausente, sem exemplo concreto de proatividade.

ATENÇÃO — evite clustering: um candidato com processo editorial claro + funil estratégico + IA concreta deve estar pelo menos 15 pontos acima de um que ficou no genérico em todos os critérios.

CLASSIFICAÇÃO:
- ✅ Avança: score ≥ 70 E demonstrou critério editorial (2) com substância real + pelo menos mais 2 critérios com substância.
- 🟡 Talvez: score entre 55-69, ou score ≥ 70 mas com processo editorial fraco/ausente, ou apenas 1 critério adicional com substância.
- ❌ Não avança: score < 55, ou sem processo editorial próprio + sem visão estratégica de funil.`
  },

  'head-produto': {
    titulo: 'Head de Produto',
    colecao: 'candidatos-head-produto',
    perguntas: [
      "Descreva uma decisão de produto que você tomou baseada em dados. Qual métrica estava em jogo, o que os dados mostravam e o que você decidiu fazer — mesmo que contrariasse a opinião de alguém?",
      "Como você garante que o time de produto está trabalhando na coisa certa? Me dá um exemplo concreto de quando você precisou repriorizar algo no meio do caminho e como conduziu isso com o time.",
      "Qual foi o produto mais incompleto com o qual você trabalhou? O que faltava, o que você fez com isso e o que aprendeu sobre construir em ambiente de incerteza?"
    ],
    promptSistema: `Você é um recrutador sênior da Curseduca avaliando candidatos para a vaga de Head de Produto. Seu papel é ser criterioso — a maioria dos candidatos NÃO deve passar nessa triagem.

PESO DA AVALIAÇÃO:
- 70% do score deve refletir a qualidade do CONTEÚDO — profundidade, exemplos reais, raciocínio de produto.
- 30% do score deve refletir CLAREZA E OBJETIVIDADE — se a pessoa comunica bem, sem enrolar. Quem é muito prolixo perde pontos mesmo tendo conteúdo, porque clareza é competência esperada de uma liderança de produto.

Critérios de avaliação (peso 70% — conteúdo):
1. Decisão baseada em dados com tensão real: cita métrica concreta, descreve o que os dados mostravam e toma uma decisão — mesmo contra opinião de alguém. Sinal de sênior: mostra a tensão e a escolha clara. Sinal de júnior: descreve o dado mas não a decisão difícil, ou a decisão não tinha risco real.
2. Liderança de priorização: sabe dar direção ao time, não só organizar o que o time já quer fazer. Sinal de sênior: reprioriza com critério claro, comunica ao time o porquê, absorve a resistência. Sinal de júnior: facilita o que o time quer, reprioriza por pressão externa sem raciocínio próprio.
3. Tolerância real a ambiguidade: age e decide em ambiente incompleto — não trava esperando ter tudo resolvido. Sinal de sênior: descreve o que faltava, o que fez com isso e o que aprendeu de forma honesta. Sinal de júnior: romantiza a incerteza sem mostrar como lidou na prática.

Critério de avaliação (peso 30% — clareza):
4. Comunicação clara e objetiva: responde o que foi perguntado sem enrolar. Penalize prolixidade real: resposta circular, repetição de ideias, excesso de contexto sem chegar ao ponto. NÃO penalize quem deu detalhes necessários para explicar bem o caso.

REGRAS DE FORMA:
- Transcrições automáticas têm erros — ignore completamente erros de pontuação e palavras trocadas.
- Se transcrição estiver '[transcrição não capturada]', não penalize — note que o áudio deve ser ouvido.

CALIBRAÇÃO DE SCORE:
Score 80+: exemplos concretos com tensão real, decisões claras com critério, comunicação direta. Muito raro.
Score 65-79: exemplos reais com substância, raciocínio de liderança visível, comunicação razoavelmente objetiva.
Score 50-64: tem experiência mas ficou no genérico — dado sem decisão difícil, priorização sem critério próprio, ou muito prolixo.
Score abaixo de 50: respostas sem caso concreto, perfil de facilitador sem liderança real, ou comunicação tão confusa que compromete a avaliação.
A maioria cai entre 50 e 72. Reserve abaixo de 50 para quem claramente não tem perfil. Reserve acima de 75 para quem claramente se destacou.

CLASSIFICAÇÃO:
- ✅ Avança: score ≥ 72 E demonstrou pelo menos 2 dos 3 critérios de conteúdo com substância real E comunicação minimamente clara (critério 4 não pode ser gravemente comprometido).
- 🟡 Talvez: score entre 55-71, ou score ≥ 72 mas com gap importante em critério essencial, ou conteúdo forte mas comunicação visivelmente confusa ou circular.
- ❌ Não avança: score < 55, ou respostas predominantemente genéricas sem nenhum exemplo real.`
  },

  'ae-b2b': {
    titulo: 'Account Executive B2B',
    colecao: 'candidatos-ae-b2b',
    perguntas: [
      "Conte sobre uma venda B2B complexa que você conduziu do zero até o fechamento. Quem eram os decisores envolvidos, qual era o ticket e quanto tempo durou o ciclo?",
      "Como você estrutura sua abordagem quando entra em uma conta nova? Me explica o seu processo desde o mapeamento até o primeiro contato com o decisor.",
      "Me fala sobre uma negociação que travou ou que você quase perdeu. O que aconteceu e como você conduziu a retomada?"
    ],
    promptSistema: `Você é um recrutador sênior da Curseduca avaliando candidatos para a vaga de Account Executive B2B. Seu papel é ser criterioso — a maioria dos candidatos NÃO deve passar nessa triagem.

Contexto da vaga: modelo ABM (Account Based Marketing), ciclo de 60 a 180 dias, ticket entre R$10k e R$100k MRR, público-alvo são C-Level, Diretores e Heads. A vaga exige método — não apenas histórico de vendas grandes.

Critérios de avaliação:
1. Experiência em vendas B2B enterprise de verdade: ticket relevante, ciclo longo, múltiplos decisores (3+). Sinal de alinhamento: descreve contexto com precisão — quem eram os decisores, qual era o ticket, quanto durou. Sinal de desalinhamento: experiência majoritariamente SMB, inbound ou transacional.
2. Processo estruturado de ABM e prospecção: tem método próprio de selecionar e mapear contas antes de prospectar. ABM NÃO precisa ser mencionado pelo nome — reconheça ABM por comportamentos concretos:
- Selecionou contas-alvo com critério (porte, setor, momento, potencial) antes de abordar
- Mapeou stakeholders com nível de influência e poder de decisão — não apenas citou cargos
- Descreveu abordagem personalizada por conta, não disparo genérico de e-mail/telefone
- Construiu relacionamento com múltiplos decisores ao longo do ciclo

ATENÇÃO — diferencie com rigor:
- "Identifiquei que o decisor era o reitor e o coordenador" = citou cargos, NÃO é account mapping
- "Mapeei quem tinha influência técnica vs. quem tinha poder de aprovação e abordei cada um de forma diferente" = account mapping real
Quem apenas cita os decisores sem descrever como chegou até eles e como os abordou estrategicamente = alerta grave, não ponto forte.
3. Resiliência e gestão de ciclo longo: consegue sustentar uma negociação complexa sem perder o fio — quando trava, tem estratégia. Sinal de alinhamento: descreve o que travou, por quê, e o que fez concretamente pra retomar. Sinal de desalinhamento: exemplo vago ou sem complexidade real.
4. Comunicação orientada a valor de negócio: fala em impacto pro cliente — receita, risco, eficiência — não em features do produto.

REGRAS CRÍTICAS — alertas que OBRIGATORIAMENTE reduzem o score:
- Ausência de processo estruturado de prospecção (critério 2) é eliminatório. Score máximo 60, mesmo com ticket alto.
- Experiência majoritariamente SMB ou inbound = score máximo 58, independente do restante.
- Mapeamento de stakeholders superficial = alerta grave, reduz score significativamente.
- Falta de familiaridade com ABM = alerta obrigatório nos alertas, impacta score.

ÂNCORA DE CALIBRAÇÃO — use como referência:
Candidato com vendas B2B de R$3MM e R$2,5MM, trabalho com C-Level, mas processo de prospecção genérico ("e-mail + telefone"), sem ABM, sem account mapping estruturado = score 55-60, classificação 🟡 Talvez ou ❌ Não avança. Experiência de ticket alto não compensa ausência de método.

REGRAS DE FORMA (seja tolerante):
- Transcrições automáticas têm erros — ignore completamente. Foque no raciocínio, não na gramática.
- Respostas longas são normais em áudio — NÃO penalize extensão.
- Se transcrição estiver '[transcrição não capturada]', não penalize — note que o áudio deve ser ouvido.

CALIBRAÇÃO DE SCORE:
Score 80+: processo ABM claro, múltiplos decisores mapeados, ciclo longo descrito com precisão, comunicação orientada a valor. Muito raro.
Score 68-79: exemplos reais com substância, processo de prospecção descrito com alguma estrutura, ABM mencionado ou praticado, ciclo e decisores presentes.
Score 55-67: tem experiência comercial real mas processo genérico, ABM ausente ou superficial.
Score abaixo de 55: experiência SMB/inbound, sem processo estruturado, sem account mapping.

CLASSIFICAÇÃO:
- ✅ Avança: score ≥ 70 E processo de prospecção estruturado demonstrado + pelo menos mais 2 critérios com substância.
- 🟡 Talvez: score entre 58-69, ou score ≥ 70 mas com gap em processo de prospecção ou ABM.
- ❌ Não avança: score < 58, ou experiência majoritariamente SMB/inbound, ou ausência total de processo estruturado.`
  }
}

const TEMPO_LIMITE = 300
const SENHA_PAINEL = "@Waid2626"

function gerarId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }
function formatarTempo(s) { const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${sec.toString().padStart(2, '0')}` }
function blobToBase64(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob) }) }
const CHUNK_SIZE = 900000
function splitBase64(b64) { const chunks = []; for (let i = 0; i < b64.length; i += CHUNK_SIZE) chunks.push(b64.slice(i, i + CHUNK_SIZE)); return chunks }
function joinBase64(chunks) { return chunks.join('') }
function getVagaFromUrl() { const params = new URLSearchParams(window.location.search); const vaga = params.get('vaga'); return VAGAS[vaga] ? vaga : null }

async function avaliarRespostas(apiKey, nome, vagaId, respostas) {
  const config = VAGAS[vagaId]
  const semTranscricao = respostas.every(r => !r.transcricao || r.transcricao.trim().length < 10)
  if (semTranscricao) return { score: null, classificacao: "🎧 Ouvir áudio", pontos_fortes: [], alertas: ["Transcrição automática não capturou as respostas — ouça os áudios diretamente no painel."], resumo: "Não foi possível avaliar automaticamente. Ouça os áudios para fazer sua avaliação." }
  const prompt = `${config.promptSistema}\n\nCandidato: "${nome}"\n\n${respostas.map((r, i) => `Pergunta ${i + 1}: ${config.perguntas[i]}\nResposta: ${r.transcricao && r.transcricao.trim().length > 10 ? r.transcricao : '[transcrição não capturada]'}\n`).join('\n')}\n\nResponda APENAS em JSON válido:\n{"score":<0-100>,"classificacao":"<✅ Avança | 🟡 Talvez | ❌ Não avança>","pontos_fortes":["..."],"alertas":["..."],"resumo":"<2 frases>"}`
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }) })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    const text = data.content?.[0]?.text || "{}"
    return JSON.parse(text.replace(/```json|```/g, "").trim())
  } catch (err) { return { score: null, classificacao: "🎧 Ouvir áudio", pontos_fortes: [], alertas: ["Erro na avaliação automática — " + (err?.message || "tente reavaliar novamente")], resumo: "Avaliação automática falhou. Use o botão Reavaliar ou ouça os áudios diretamente." } }
}

const S = {
  page: { minHeight: '100vh', background: 'linear-gradient(135deg,#0f172a,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'system-ui,sans-serif' },
  box: { background: 'white', borderRadius: '16px', padding: '40px', maxWidth: '600px', width: '100%', boxShadow: '0 25px 50px rgba(0,0,0,.3)' },
  btn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', width: '100%', marginTop: '16px' },
  btnSm: { border: 'none', borderRadius: '10px', padding: '12px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  inp: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', outline: 'none' },
  bar: { background: '#e2e8f0', borderRadius: '99px', height: '8px', margin: '0 0 32px' },
  barIn: (p) => ({ background: '#7c3aed', borderRadius: '99px', height: '8px', width: `${p}%`, transition: 'width .4s' }),
  qbox: { background: '#f8fafc', borderRadius: '12px', padding: '20px', margin: '0 0 24px', borderLeft: '4px solid #7c3aed' },
  badge: { display: 'inline-block', background: '#ede9fe', color: '#7c3aed', borderRadius: '99px', padding: '4px 12px', fontSize: '12px', fontWeight: '600', margin: '0 0 16px' },
  row: { display: 'flex', gap: '12px', marginTop: '16px', alignItems: 'center' },
  aviso: { background: '#f0fdf4', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px', borderLeft: '4px solid #16a34a' },
  avisoAmarelo: { background: '#fffbeb', borderRadius: '12px', padding: '14px 18px', marginBottom: '24px', borderLeft: '4px solid #f59e0b' },
  timer: (d) => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', borderRadius: '10px', background: d ? '#fef2f2' : '#f8fafc', border: `2px solid ${d ? '#dc2626' : '#e2e8f0'}`, marginBottom: '16px', fontSize: '20px', fontWeight: '700', color: d ? '#dc2626' : '#1e293b', fontVariantNumeric: 'tabular-nums' }),
  sc: (n) => ({ display: 'inline-block', background: n >= 70 ? '#dcfce7' : n >= 50 ? '#fef9c3' : '#fee2e2', color: n >= 70 ? '#16a34a' : n >= 50 ? '#ca8a04' : '#dc2626', borderRadius: '99px', padding: '4px 14px', fontSize: '13px', fontWeight: '700' })
}

function TelaLinkInvalido() {
  return <div style={S.page}><div style={{ ...S.box, textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '16px' }}>🔗</div><h2 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>Link inválido</h2><p style={{ color: '#64748b', fontSize: '14px', lineHeight: '1.6' }}>Este link não corresponde a nenhuma vaga ativa. Verifique o link que você recebeu ou entre em contato com a equipe de Gente & Cultura da Curseduca.</p></div></div>
}

function TelaCandidato({ apiKey, vagaId, onFinalizar }) {
  const config = VAGAS[vagaId]
  const [nome, setNome] = useState("")
  const [candidatoId] = useState(gerarId)
  const [iniciado, setIniciado] = useState(false)
  const [pergAtual, setPergAtual] = useState(0)
  const [respostas, setRespostas] = useState([])
  const [gravando, setGravando] = useState(false)
  const [tempoRestante, setTempoRestante] = useState(TEMPO_LIMITE)
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [transcricao, setTranscricao] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [concluido, setConcluido] = useState(false)
  const [feedback, setFeedback] = useState({ nota: 0, conforto: '', comentario: '' })
  const [feedbackEnviado, setFeedbackEnviado] = useState(false)
  const [revisando, setRevisando] = useState(false)
  const [reviewUrls, setReviewUrls] = useState([])
  const mediaRecRef = useRef(null)
  const chunksRef = useRef([])
  const speechRef = useRef(null)
  const timerRef = useRef(null)
  const transcricaoRef = useRef("")

  const limparEstado = useCallback(() => { if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioBlob(null); setAudioUrl(null); setTranscricao(""); setTempoRestante(TEMPO_LIMITE); transcricaoRef.current = "" }, [audioUrl])
  const pararGravacao = useCallback(() => { setGravando(false); if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }; if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') { try { mediaRecRef.current.stop() } catch {} }; if (speechRef.current) { try { speechRef.current.stop() } catch {}; speechRef.current = null } }, [])

  useEffect(() => { return () => { pararGravacao() } }, [pararGravacao])
  useEffect(() => { return () => { reviewUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch {} }) } }, [reviewUrls])

  const iniciarGravacao = async () => {
    limparEstado()
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { alert("Permissão de microfone negada. Clique no ícone de cadeado na barra do navegador e permita o acesso ao microfone."); return }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' }); setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob)); setTranscricao(transcricaoRef.current) }
    mediaRecRef.current = mr; mr.start(1000)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SR) {
      const srLang = (vagaId === 'csm-latam' && pergAtual === config.perguntas.length - 1) ? 'es-419' : 'pt-BR'
      const sr = new SR(); sr.lang = srLang; sr.continuous = true; sr.interimResults = true; let ft = ""
      sr.onresult = (e) => { const f = Array.from(e.results).filter(x => x.isFinal).map(x => x[0].transcript).join(' '); const int = Array.from(e.results).filter(x => !x.isFinal).map(x => x[0].transcript).join(' '); ft = f; transcricaoRef.current = ft; setTranscricao(ft + (int ? ' ' + int : '')) }
      sr.onerror = () => {}; sr.onend = () => { transcricaoRef.current = ft }
      speechRef.current = sr; try { sr.start() } catch {}
    }
    setTempoRestante(TEMPO_LIMITE); setGravando(true)
    timerRef.current = setInterval(() => { setTempoRestante(prev => { if (prev <= 1) { pararGravacao(); return 0 }; return prev - 1 }) }, 1000)
  }

  const salvarRespostaAtual = (blob, transcrAtual, tempoAtual, arr) => { const novas = [...arr]; novas[pergAtual] = { blob, transcricao: transcrAtual, duracao: TEMPO_LIMITE - tempoAtual }; return novas }

  const avancar = () => {
    if (!audioBlob) return
    const novas = salvarRespostaAtual(audioBlob, transcricaoRef.current || transcricao, tempoRestante, respostas)
    setRespostas(novas)
    if (pergAtual + 1 < config.perguntas.length) { limparEstado(); setPergAtual(pergAtual + 1) }
    else { if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioBlob(null); setAudioUrl(null); setTranscricao(""); transcricaoRef.current = ""; setReviewUrls(novas.map(r => URL.createObjectURL(r.blob))); setRevisando(true) }
  }

  const voltar = () => {
    if (gravando) pararGravacao()
    let novas = respostas
    if (audioBlob) { novas = salvarRespostaAtual(audioBlob, transcricaoRef.current || transcricao, tempoRestante, respostas); setRespostas(novas) }
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    const prev = novas[pergAtual - 1]
    if (prev) { setAudioBlob(prev.blob); setAudioUrl(URL.createObjectURL(prev.blob)); setTranscricao(prev.transcricao); transcricaoRef.current = prev.transcricao; setTempoRestante(TEMPO_LIMITE - prev.duracao) }
    else { setAudioBlob(null); setAudioUrl(null); setTranscricao(""); transcricaoRef.current = ""; setTempoRestante(TEMPO_LIMITE) }
    setPergAtual(pergAtual - 1)
  }

  const voltarDaRevisao = () => {
    reviewUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch {} }); setReviewUrls([]); setRevisando(false)
    const ultima = respostas[respostas.length - 1]
    if (ultima) { setAudioBlob(ultima.blob); setAudioUrl(URL.createObjectURL(ultima.blob)); setTranscricao(ultima.transcricao); transcricaoRef.current = ultima.transcricao; setTempoRestante(TEMPO_LIMITE - ultima.duracao) }
    setPergAtual(config.perguntas.length - 1)
  }

  const finalizarEnvio = async (todas) => {
    setEnviando(true)
    try {
      const resSemAudio = todas.map((r, i) => ({ pergunta: i, transcricao: r.transcricao, duracao: r.duracao }))
      const aval = await avaliarRespostas(apiKey, nome, vagaId, todas)
      const docRef = await addDoc(collection(db, config.colecao), { nome, candidatoId, vaga: vagaId, respostas: resSemAudio, avaliacao: aval, etapa: 'triagem', data: new Date().toLocaleDateString("pt-BR"), timestamp: new Date() })
      const errosAudio = []
      for (let i = 0; i < todas.length; i++) {
        try {
          const fixedBlob = await fixWebmSeek(todas[i].blob); const b64 = await blobToBase64(fixedBlob); const chunks = splitBase64(b64)
          await setDoc(doc(db, config.colecao, docRef.id, "audios", `pergunta-${i}`), { pergunta: i, duracao: todas[i].duracao, totalChunks: chunks.length, ...(chunks.length === 1 ? { audioBase64: b64 } : {}) })
          if (chunks.length > 1) { for (let c = 0; c < chunks.length; c++) { await setDoc(doc(db, config.colecao, docRef.id, "audios", `pergunta-${i}-chunk-${c}`), { pergunta: i, chunk: c, data: chunks[c] }) } }
        } catch { errosAudio.push(i + 1) }
      }
      if (errosAudio.length > 0) await setDoc(doc(db, config.colecao, docRef.id), { errosAudio }, { merge: true })
      setConcluido(true); onFinalizar()
    } catch (err) { alert("Erro ao enviar: " + err.message); setEnviando(false) }
  }

  const enviarFeedback = async () => {
    try { await addDoc(collection(db, 'feedback-entrevistas'), { vaga: vagaId, nota: feedback.nota, conforto: feedback.conforto, comentario: feedback.comentario, data: new Date().toLocaleDateString('pt-BR'), timestamp: new Date() }) } catch {}
    setFeedbackEnviado(true)
  }

  if (concluido && feedbackEnviado) return <div style={S.page}><div style={{ ...S.box, textAlign: 'center' }}><div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div><h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a' }}>Tudo certo!</h2><p style={{ color: '#64748b', marginTop: '8px' }}>Obrigado, {nome}! Nossa equipe vai ouvir suas respostas e entrará em contato em breve.</p></div></div>

  if (concluido) return (
    <div style={S.page}><div style={S.box}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}><div style={{ fontSize: '48px', marginBottom: '8px' }}>🎉</div><h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>Entrevista enviada!</h2><p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 4px' }}>Antes de fechar, conta pra gente como foi.</p><p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>🔒 Esse feedback é <strong>100% anônimo</strong> — suas respostas não são vinculadas ao seu nome e não afetam o processo seletivo. Seja transparente! 😊</p></div>
      <div style={{ marginBottom: '20px' }}><p style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b', marginBottom: '10px' }}>Como você avalia sua experiência com essa etapa?</p><div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>{[1,2,3,4,5].map(n => (<button key={n} onClick={() => setFeedback(f => ({ ...f, nota: n }))} style={{ width: '44px', height: '44px', borderRadius: '50%', border: `2px solid ${feedback.nota === n ? '#7c3aed' : '#e2e8f0'}`, background: feedback.nota === n ? '#7c3aed' : 'white', color: feedback.nota === n ? 'white' : '#475569', fontSize: '16px', fontWeight: '700', cursor: 'pointer' }}>{n}</button>))}</div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', padding: '0 4px' }}><span style={{ fontSize: '11px', color: '#94a3b8' }}>Péssima</span><span style={{ fontSize: '11px', color: '#94a3b8' }}>Ótima</span></div></div>
      <div style={{ marginBottom: '20px' }}><p style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b', marginBottom: '10px' }}>Como você se sentiu respondendo por áudio?</p><div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>{['Muito confortável', 'Confortável', 'Neutro', 'Desconfortável'].map(op => (<button key={op} onClick={() => setFeedback(f => ({ ...f, conforto: op }))} style={{ padding: '8px 14px', borderRadius: '99px', border: `2px solid ${feedback.conforto === op ? '#7c3aed' : '#e2e8f0'}`, background: feedback.conforto === op ? '#ede9fe' : 'white', color: feedback.conforto === op ? '#7c3aed' : '#475569', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>{op}</button>))}</div></div>
      <div style={{ marginBottom: '24px' }}><p style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b', marginBottom: '8px' }}>Algum comentário? <span style={{ fontWeight: '400', color: '#94a3b8' }}>(opcional)</span></p><textarea value={feedback.comentario} onChange={e => setFeedback(f => ({ ...f, comentario: e.target.value }))} placeholder="Pode falar à vontade..." style={{ width: '100%', padding: '12px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', minHeight: '80px', resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} /></div>
      <button style={{ ...S.btn, opacity: feedback.nota > 0 ? 1 : 0.4 }} onClick={feedback.nota > 0 ? enviarFeedback : undefined}>Enviar feedback e finalizar →</button>
      <button onClick={enviarFeedback} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '13px', cursor: 'pointer', width: '100%', marginTop: '12px', padding: '4px' }}>Pular</button>
    </div></div>
  )

  if (enviando) return <div style={S.page}><div style={{ ...S.box, textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div><h2 style={{ fontSize: '22px', fontWeight: '700' }}>Enviando suas respostas...</h2><p style={{ color: '#64748b', marginTop: '8px' }}>Estamos salvando seus áudios e analisando suas respostas. Não feche a página.</p></div></div>

  if (revisando) return (
    <div style={S.page}><div style={S.box}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}><div style={{ fontSize: '40px', marginBottom: '8px' }}>🎧</div><h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>Revise suas respostas</h2><p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Ouça antes de enviar. Se quiser regravar, use o botão voltar.</p></div>
      {respostas.map((r, i) => (<div key={i} style={{ background: '#f8fafc', borderRadius: '12px', padding: '16px', marginBottom: '16px', borderLeft: '4px solid #7c3aed' }}><p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: '700', color: '#7c3aed' }}>Pergunta {i + 1}</p><p style={{ margin: '0 0 12px', fontSize: '14px', color: '#1e293b', lineHeight: '1.5' }}>{config.perguntas[i]}</p><audio controls src={reviewUrls[i]} style={{ width: '100%', borderRadius: '8px' }} /><p style={{ margin: '8px 0 0', fontSize: '12px', color: '#7c3aed' }}>⏱ {formatarTempo(r.duracao)}</p></div>))}
      {(() => {
        const semT = respostas.filter(r => !r.transcricao || r.transcricao.trim().length < 10).length
        if (semT === respostas.length) return <div style={{ background: '#fef2f2', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px', borderLeft: '3px solid #dc2626' }}><p style={{ margin: 0, fontSize: '13px', color: '#dc2626', lineHeight: '1.6' }}>⚠️ <strong>Nenhuma transcrição foi capturada.</strong> Isso pode indicar que o microfone não estava funcionando corretamente. Recomendamos voltar e regravar em local silencioso.<br />Se preferir enviar assim mesmo, o time de G&C vai ouvir os áudios diretamente.</p></div>
        if (semT > 0) return <div style={{ background: '#fffbeb', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px', borderLeft: '3px solid #f59e0b' }}><p style={{ margin: 0, fontSize: '13px', color: '#92400e', lineHeight: '1.6' }}>⚠️ <strong>{semT} resposta{semT > 1 ? 's' : ''} sem transcrição.</strong> Confira os áudios acima. Se a gravação ficou boa, pode enviar — o time vai ouvir diretamente.</p></div>
        return <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '12px 16px', marginBottom: '12px', borderLeft: '3px solid #16a34a' }}><p style={{ margin: 0, fontSize: '13px', color: '#15803d', lineHeight: '1.6' }}>✅ Transcrições capturadas. Ouça os áudios acima para confirmar que ficaram bons antes de enviar.</p></div>
      })()}
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
        <button style={{ ...S.btnSm, background: '#f1f5f9', color: '#475569', flex: 1, padding: '14px' }} onClick={voltarDaRevisao}>← Voltar</button>
        <button style={{ ...S.btn, marginTop: 0, flex: 2 }} onClick={() => finalizarEnvio(respostas)}>Enviar entrevista ✓</button>
      </div>
    </div></div>
  )

  if (!iniciado) return (
    <div style={S.page}><div style={S.box}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}><div style={{ fontSize: '48px', marginBottom: '12px' }}>🎤</div><h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>{config.titulo}</h1><p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Curseduca • Entrevista por Áudio</p></div>
      <div style={S.aviso}><p style={{ margin: '0 0 8px', fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Olá! Essa é uma etapa do nosso processo seletivo feita por áudio.</p><p style={{ margin: '0 0 8px', fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Você vai responder <strong>{config.perguntas.length} perguntas</strong> gravando sua voz. Cada resposta tem um limite de <strong>5 minutos</strong>.</p><p style={{ margin: 0, fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Responda com naturalidade, como se estivesse em uma conversa. 🙌</p></div>
      <div style={S.avisoAmarelo}>
        <p style={{ margin: 0, fontSize: '13px', color: '#92400e', lineHeight: '1.6' }}>⚠️ <strong>Sobre a transcrição automática:</strong> o sistema pode não capturar todas as palavras — e tudo bem! O time de G&C vai <strong>ouvir os áudios</strong> diretamente. 🎧</p>
        {vagaId === 'csm-latam' && <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#92400e', lineHeight: '1.6' }}>🌎 <strong>Uma das perguntas deve ser respondida em espanhol.</strong> Não se preocupe com perfeição — o que importa é que a comunicação seja natural e você consiga se expressar à vontade.</p>}
      </div>
      <p style={{ color: '#475569', marginBottom: '16px', lineHeight: '1.6', fontSize: '14px' }}>Use <strong>Google Chrome</strong> no computador. Certifique-se de estar em um ambiente silencioso.</p>
      <div style={{ background: '#f1f5f9', borderRadius: '10px', padding: '12px 16px', marginBottom: '24px', fontSize: '13px', color: '#64748b', lineHeight: '1.6' }}>💬 Ao final da entrevista, você vai encontrar uma <strong>tela de feedback anônimo</strong> sobre a sua experiência. É rápido e opcional — mas sua opinião nos ajuda muito.</div>
      <input style={S.inp} placeholder="Seu nome completo" value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && nome.trim() && setIniciado(true)} />
      <button style={{ ...S.btn, opacity: nome.trim() ? 1 : .5 }} onClick={() => nome.trim() && setIniciado(true)}>Começar →</button>
    </div></div>
  )

  const temAudio = !!audioBlob
  const danger = gravando && tempoRestante <= 30
  const isUltima = pergAtual + 1 === config.perguntas.length

  return (
    <div style={S.page}><div style={S.box}>
      <span style={S.badge}>Pergunta {pergAtual + 1} de {config.perguntas.length}</span>
      <div style={S.bar}><div style={S.barIn((pergAtual / config.perguntas.length) * 100)} /></div>
      <div style={S.qbox}><p style={{ margin: 0, fontSize: '17px', fontWeight: '600', color: '#1e293b', lineHeight: '1.5' }}>{config.perguntas[pergAtual]}</p></div>
      <div style={{ background: '#fffbeb', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', borderLeft: '3px solid #f59e0b' }}><p style={{ margin: 0, fontSize: '12px', color: '#92400e', lineHeight: '1.6' }}>💡 <strong>Dica:</strong> grave em local silencioso e fale próximo ao microfone.</p></div>
      {(gravando || temAudio) && <div style={S.timer(danger)}>{gravando && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#dc2626', animation: 'pulse 1s infinite' }} />}{gravando ? `${formatarTempo(tempoRestante)} restantes` : `Duração: ${formatarTempo(TEMPO_LIMITE - tempoRestante)}`}</div>}
      {temAudio && !gravando && <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}><p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '600', color: '#475569' }}>🔊 Ouça sua resposta:</p><audio controls src={audioUrl} style={{ width: '100%', borderRadius: '8px', marginTop: '4px' }} />{transcricao && <details style={{ marginTop: '12px' }}><summary style={{ fontSize: '13px', color: '#7c3aed', cursor: 'pointer' }}>Ver transcrição automática</summary><p style={{ margin: '8px 0 0', fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>{transcricao}</p></details>}</div>}
      {gravando && transcricao && <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px', marginBottom: '16px', border: '1px solid #e2e8f0' }}><p style={{ margin: 0, fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>{transcricao}</p></div>}
      <div style={S.row}>
        {!gravando && pergAtual > 0 && <button style={{ ...S.btnSm, background: '#f1f5f9', color: '#475569' }} onClick={voltar}>← Voltar</button>}
        {!gravando && !temAudio && <button style={{ ...S.btn, marginTop: 0, flex: 1 }} onClick={iniciarGravacao}>🎙 Gravar resposta</button>}
        {gravando && <button style={{ ...S.btnSm, background: '#dc2626', color: 'white', flex: 1 }} onClick={pararGravacao}>⏹ Parar gravação</button>}
        {temAudio && !gravando && <><button style={{ ...S.btnSm, background: '#f1f5f9', color: '#475569' }} onClick={limparEstado}>🔄 Regravar</button><button style={{ ...S.btn, marginTop: 0, flex: 1 }} onClick={avancar}>{isUltima ? 'Revisar →' : 'Próxima →'}</button></>}
      </div>
    </div><style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style></div>
  )
}

function Painel({ onVoltar, apiKey }) {
  const [senha, setSenha] = useState("")
  const [auth, setAuth] = useState(false)
  const [candidatos, setCandidatos] = useState([])
  const [exp, setExp] = useState(null)
  const [telaInicial, setTelaInicial] = useState(true)
  const [vagaAtiva, setVagaAtiva] = useState("csm-senior")
  const [filtroStatus, setFiltroStatus] = useState("todos")
  const [abaAtiva, setAbaAtiva] = useState("triagem")
  const [vagasFechadas, setVagasFechadas] = useState(() => { try { return JSON.parse(localStorage.getItem('vagas_fechadas') || '[]') } catch { return [] } })
  const [carregando, setCarregando] = useState(false)
  const [reavaliando, setReavaliando] = useState(null)
  const [passando, setPassando] = useState(null)
  const [reprovando, setReprovando] = useState(null)
  const [audiosCarregados, setAudiosCarregados] = useState({})
  const [blobUrls, setBlobUrls] = useState({})
  const [carregandoAudio, setCarregandoAudio] = useState(null)
  const [ordenacao, setOrdenacao] = useState('data-desc')
  const [feedbacks, setFeedbacks] = useState([])
  const [carregandoFeedbacks, setCarregandoFeedbacks] = useState(false)
  const [ultimoAcesso, setUltimoAcesso] = useState(null)

  const LISTA_VAGAS = [
    ['csm-senior',    'Customer Success Manager Sênior', '#ede9fe', '#7c3aed'],
    ['csm-latam',     'CSM Sênior — LATAM',              '#e0f2fe', '#0369a1'],
    ['salesops',      'Sales Operations',                '#fef9c3', '#92400e'],
    ['copywriter-sr', 'Copywriter Sênior',               '#fce7f3', '#9d174d'],
    ['head-produto',  'Head de Produto',                 '#dcfce7', '#15803d'],
    ['ae-b2b',        'Account Executive B2B',           '#fff7ed', '#c2410c'],
  ]

  const vagaBadgeStyle = (vaga) => { const found = LISTA_VAGAS.find(([v]) => v === vaga); return { display: 'inline-block', background: found?.[2] || '#f1f5f9', color: found?.[3] || '#475569', borderRadius: '99px', padding: '2px 10px', fontSize: '11px', fontWeight: '600' } }
  const vagaLabel = (vaga) => LISTA_VAGAS.find(([v]) => v === vaga)?.[1] || vaga

  const carregarCandidatos = async () => {
    setCarregando(true)
    try {
      const todos = []
      for (const [vId, cfg] of Object.entries(VAGAS)) { const q = query(collection(db, cfg.colecao), orderBy("timestamp", "desc")); const snap = await getDocs(q); snap.docs.forEach(d => todos.push({ id: d.id, colecao: cfg.colecao, ...d.data() })) }
      todos.sort((a, b) => (b.timestamp?.toDate?.() || 0) - (a.timestamp?.toDate?.() || 0)); setCandidatos(todos)
    } catch (e) { alert("Erro ao carregar: " + e.message) }
    setCarregando(false)
  }

  const carregarAudios = async (c) => {
    if (audiosCarregados[c.id]) return; setCarregandoAudio(c.id)
    try {
      const snap = await getDocs(collection(db, c.colecao, c.id, "audios")); const docs = {}; snap.docs.forEach(d => { docs[d.id] = d.data() }); const a = {}; const urls = {}
      const perguntas = new Set(Object.values(docs).map(d => d.pergunta).filter(p => p !== undefined))
      for (const p of perguntas) {
        const meta = docs[`pergunta-${p}`]; if (!meta) continue
        let b64 = null
        if (meta.audioBase64) { b64 = meta.audioBase64 }
        else if (meta.totalChunks > 1) { const parts = []; for (let c2 = 0; c2 < meta.totalChunks; c2++) { const chunkDoc = docs[`pergunta-${p}-chunk-${c2}`]; if (chunkDoc) parts.push(chunkDoc.data) }; if (parts.length === meta.totalChunks) b64 = joinBase64(parts) }
        if (b64) {
          a[p] = b64
          try {
            const dataUrl = b64.startsWith('data:') ? b64 : `data:audio/webm;base64,${b64}`
            const res = await fetch(dataUrl); const rawBlob = await res.blob()
            const fixedBlob = await fixWebmSeek(rawBlob)
            urls[p] = URL.createObjectURL(fixedBlob)
          } catch (err) { console.warn('blob fallback p' + p, err); urls[p] = null }
        }
      }
      setAudiosCarregados(prev => ({ ...prev, [c.id]: a }))
      setBlobUrls(prev => ({ ...prev, [c.id]: urls }))
    } catch { setAudiosCarregados(prev => ({ ...prev, [c.id]: {} })) }
    setCarregandoAudio(null)
  }

  const reavaliar = async (c, e) => { e.stopPropagation(); if (!c.respostas) return; setReavaliando(c.id); try { const novaAval = await avaliarRespostas(apiKey, c.nome, c.vaga || 'csm-senior', c.respostas); await updateDoc(doc(db, c.colecao, c.id), { avaliacao: novaAval }); setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, avaliacao: novaAval } : x)) } catch (err) { alert("Erro ao reavaliar: " + err.message) }; setReavaliando(null) }
  const passarProximaEtapa = async (c, e) => { e.stopPropagation(); if (!confirm(`Passar ${c.nome} para a próxima etapa?`)) return; setPassando(c.id); try { await updateDoc(doc(db, c.colecao, c.id), { etapa: 'aprovado', dataAprovacao: new Date().toLocaleDateString("pt-BR") }); setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, etapa: 'aprovado', dataAprovacao: new Date().toLocaleDateString("pt-BR") } : x)); setExp(null) } catch (err) { alert("Erro: " + err.message) }; setPassando(null) }
  const reprovar = async (c, e) => { e.stopPropagation(); if (!confirm(`Reprovar ${c.nome}?`)) return; setReprovando(c.id); try { await updateDoc(doc(db, c.colecao, c.id), { etapa: 'reprovado', dataReprovacao: new Date().toLocaleDateString("pt-BR") }); setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, etapa: 'reprovado', dataReprovacao: new Date().toLocaleDateString("pt-BR") } : x)); setExp(null) } catch (err) { alert("Erro: " + err.message) }; setReprovando(null) }
  const voltarParaTriagem = async (c, e) => { e.stopPropagation(); try { await updateDoc(doc(db, c.colecao, c.id), { etapa: 'triagem' }); setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, etapa: 'triagem' } : x)); setExp(null) } catch (err) { alert("Erro: " + err.message) } }
  const deletar = async (c, e) => { e.stopPropagation(); if (!confirm(`Apagar ${c.nome}?`)) return; try { const aSnap = await getDocs(collection(db, c.colecao, c.id, "audios")); for (const ad of aSnap.docs) await deleteDoc(doc(db, c.colecao, c.id, "audios", ad.id)); await deleteDoc(doc(db, c.colecao, c.id)); setCandidatos(prev => prev.filter(x => x.id !== c.id)); setAudiosCarregados(prev => { const n = { ...prev }; delete n[c.id]; return n }); setBlobUrls(prev => { const n = { ...prev }; if (n[c.id]) { Object.values(n[c.id]).forEach(u => { try { URL.revokeObjectURL(u) } catch {} }) }; delete n[c.id]; return n }) } catch (e) { alert("Erro: " + e.message) } }
  const carregarFeedbacks = async () => { setCarregandoFeedbacks(true); try { const q = query(collection(db, 'feedback-entrevistas'), orderBy('timestamp', 'desc')); const snap = await getDocs(q); setFeedbacks(snap.docs.map(d => ({ id: d.id, ...d.data() }))) } catch (e) { console.error(e) }; setCarregandoFeedbacks(false) }

  useEffect(() => { if (auth) { const chave = 'painel_ultimo_acesso'; const anterior = localStorage.getItem(chave); setUltimoAcesso(anterior ? new Date(anterior) : null); localStorage.setItem(chave, new Date().toISOString()); carregarCandidatos() } }, [auth])

  const fecharVaga = (vagaId) => { const novas = [...vagasFechadas, vagaId]; setVagasFechadas(novas); localStorage.setItem('vagas_fechadas', JSON.stringify(novas)) }
  const reabrirVaga = (vagaId) => { const novas = vagasFechadas.filter(v => v !== vagaId); setVagasFechadas(novas); localStorage.setItem('vagas_fechadas', JSON.stringify(novas)) }
  const expandir = (i, c) => { if (exp === i) { setExp(null) } else { setExp(i); carregarAudios(c) } }
  const isNovo = (x) => { if (!ultimoAcesso) return false; const ts = x.timestamp?.toDate?.(); return ts && ts > ultimoAcesso }
  const totalNovos = candidatos.filter(isNovo).length

  useEffect(() => { if (!auth) return; document.title = totalNovos > 0 ? `(${totalNovos} novo${totalNovos > 1 ? 's' : ''}) Painel G&C — Entrevistas por Áudio` : 'Painel G&C — Entrevistas por Áudio'; return () => { document.title = 'Entrevistas por Áudio — Curseduca' } }, [totalNovos, auth])

  const sP = {
    page: { minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', padding: '32px 20px' },
    card: { background: 'white', borderRadius: '12px', padding: '20px', maxWidth: '900px', margin: '0 auto 16px', boxShadow: '0 1px 3px rgba(0,0,0,.1)', cursor: 'pointer' },
    btn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    btnVerde: { background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    btnVermelho: { background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    btnCinza: { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    btnRoxo: { background: '#ede9fe', color: '#7c3aed', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    out: { background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' },
    inp: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', outline: 'none', marginBottom: '16px' },
    abaBotao: (ativa) => ({ background: ativa ? '#7c3aed' : 'white', color: ativa ? 'white' : '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }),
    filtroBotao: (ativo) => ({ background: ativo ? '#7c3aed' : 'white', color: ativo ? 'white' : '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' })
  }

  if (!auth) return (
    <div style={{ ...sP.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '100%', boxShadow: '0 10px 30px rgba(0,0,0,.1)' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Painel G&C</h2>
        <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '14px' }}>Acesso restrito à equipe Curseduca</p>
        <input style={sP.inp} type="password" placeholder="Senha" value={senha} onChange={e => setSenha(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && senha === SENHA_PAINEL) setAuth(true) }} />
        <button style={{ ...sP.btn, width: '100%' }} onClick={() => { if (senha === SENHA_PAINEL) setAuth(true); else alert("Senha incorreta") }}>Entrar</button>
        <button style={{ ...sP.out, width: '100%', marginTop: '12px' }} onClick={onVoltar}>← Voltar</button>
      </div>
    </div>
  )

  const candidatosDaVaga = candidatos.filter(x => x.vaga === vagaAtiva)
  const emTriagem = candidatosDaVaga.filter(x => !x.etapa || x.etapa === 'triagem')
  const aprovados = candidatosDaVaga.filter(x => x.etapa === 'aprovado')
  const reprovados = candidatosDaVaga.filter(x => x.etapa === 'reprovado')
  let listaAtiva = abaAtiva === 'triagem' ? emTriagem : abaAtiva === 'aprovados' ? aprovados : reprovados
  if (abaAtiva === 'triagem' && filtroStatus !== "todos") listaAtiva = listaAtiva.filter(x => x.avaliacao?.classificacao?.includes(filtroStatus === "avanca" ? "Avança" : filtroStatus === "talvez" ? "Talvez" : "Não avança"))
  listaAtiva = [...listaAtiva].sort((a, b) => {
    if (ordenacao === 'data-desc') return (b.timestamp?.toDate?.() || 0) - (a.timestamp?.toDate?.() || 0)
    if (ordenacao === 'data-asc') return (a.timestamp?.toDate?.() || 0) - (b.timestamp?.toDate?.() || 0)
    if (ordenacao === 'score-desc') return (b.avaliacao?.score ?? -1) - (a.avaliacao?.score ?? -1)
    if (ordenacao === 'score-asc') return (a.avaliacao?.score ?? -1) - (b.avaliacao?.score ?? -1)
    if (ordenacao === 'nome-asc') return a.nome?.localeCompare(b.nome)
    if (ordenacao === 'nome-desc') return b.nome?.localeCompare(a.nome)
    return 0
  })

  if (telaInicial) return (
    <div style={sP.page}>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '12px' }}>
          <div><h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Painel G&C</h1><p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>Selecione uma vaga para ver os candidatos</p></div>
          <div style={{ display: 'flex', gap: '8px' }}><button style={sP.btn} onClick={carregarCandidatos} disabled={carregando}>{carregando ? "Carregando..." : "🔄 Atualizar"}</button>{totalNovos > 0 && <span style={{ background: '#dc2626', color: 'white', borderRadius: '99px', padding: '6px 12px', fontSize: '13px', fontWeight: '700', display: 'flex', alignItems: 'center' }}>🔴 {totalNovos} novo{totalNovos > 1 ? 's' : ''}</span>}</div>
        </div>
        <h2 style={{ fontSize: '14px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Vagas ativas</h2>
        <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
          {LISTA_VAGAS.filter(([v]) => !vagasFechadas.includes(v)).map(([v, l, bg, cor]) => {
            const emTriagemV = candidatos.filter(x => x.vaga === v && (!x.etapa || x.etapa === 'triagem')).length
            const aprovadosV = candidatos.filter(x => x.vaga === v && x.etapa === 'aprovado').length
            const novosV = candidatos.filter(x => x.vaga === v && isNovo(x)).length
            return <div key={v} style={{ background: 'white', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,.08)', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}><span style={{ background: bg, color: cor, borderRadius: '8px', padding: '6px 14px', fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap' }}>{l}</span><div style={{ flex: 1, display: 'flex', gap: '16px', flexWrap: 'wrap' }}><span style={{ fontSize: '13px', color: '#64748b' }}>{emTriagemV} em triagem</span><span style={{ fontSize: '13px', color: '#16a34a' }}>{aprovadosV} aprovado{aprovadosV !== 1 ? 's' : ''}</span>{novosV > 0 && <span style={{ background: '#dc2626', color: 'white', borderRadius: '99px', padding: '1px 8px', fontSize: '12px', fontWeight: '700' }}>🔴 {novosV} novo{novosV > 1 ? 's' : ''}</span>}</div><div style={{ display: 'flex', gap: '8px' }}><button onClick={() => { setVagaAtiva(v); setTelaInicial(false); setAbaAtiva('triagem'); setExp(null); setFiltroStatus('todos') }} style={{ ...sP.btn, marginTop: 0, padding: '8px 18px', fontSize: '13px', width: 'auto' }}>Ver candidatos →</button><button onClick={() => { if(confirm('Encerrar a vaga ' + l + '? Os dados ficam salvos e você pode reabrir depois.')) fecharVaga(v) }} style={{ background: 'white', color: '#94a3b8', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}>Encerrar</button></div></div>
          })}
        </div>
        {vagasFechadas.length > 0 && <><h2 style={{ fontSize: '14px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Vagas encerradas</h2><div style={{ display: 'grid', gap: '8px', marginBottom: '32px' }}>{LISTA_VAGAS.filter(([v]) => vagasFechadas.includes(v)).map(([v, l]) => { const total = candidatos.filter(x => x.vaga === v).length; const aprovadosV = candidatos.filter(x => x.vaga === v && x.etapa === 'aprovado').length; return <div key={v} style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', border: '1px solid #e2e8f0' }}><span style={{ background: '#f1f5f9', color: '#94a3b8', borderRadius: '8px', padding: '4px 12px', fontSize: '12px', fontWeight: '600' }}>{l}</span><span style={{ fontSize: '13px', color: '#94a3b8', flex: 1 }}>{total} candidato{total !== 1 ? 's' : ''} · {aprovadosV} aprovado{aprovadosV !== 1 ? 's' : ''}</span><div style={{ display: 'flex', gap: '8px' }}><button onClick={() => { setVagaAtiva(v); setTelaInicial(false); setAbaAtiva('triagem'); setExp(null) }} style={{ background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', cursor: 'pointer' }}>Ver resultados</button><button onClick={() => reabrirVaga(v)} style={{ background: 'white', color: '#7c3aed', border: '1px solid #7c3aed', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>Reabrir</button></div></div> })}</div></>}
        <div style={{ display: 'flex', gap: '8px' }}><button onClick={() => { setAbaAtiva('links'); setTelaInicial(false) }} style={{ ...sP.out, fontSize: '13px', padding: '8px 16px' }}>🔗 Links das vagas</button><button onClick={() => { setAbaAtiva('feedback'); setTelaInicial(false); carregarFeedbacks() }} style={{ ...sP.out, fontSize: '13px', padding: '8px 16px' }}>💬 Feedbacks</button></div>
      </div>
    </div>
  )

  return (
    <div style={sP.page}>
      <div style={{ maxWidth: '900px', margin: '0 auto 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div><button onClick={() => setTelaInicial(true)} style={{ background: 'none', border: 'none', color: '#7c3aed', fontSize: '13px', cursor: 'pointer', padding: '0 0 4px', fontWeight: '600' }}>← Todas as vagas</button><h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>{VAGAS[vagaAtiva]?.titulo}</h1>{totalNovos > 0 && <span style={{ background: '#dc2626', color: 'white', borderRadius: '99px', padding: '1px 8px', fontSize: '11px', fontWeight: '700', marginTop: '4px', display: 'inline-block' }}>🔴 {totalNovos} novo{totalNovos > 1 ? 's' : ''}</span>}</div>
        <div style={{ display: 'flex', gap: '8px' }}><button style={sP.btn} onClick={carregarCandidatos} disabled={carregando}>{carregando ? "Carregando..." : "🔄 Atualizar"}</button><button style={sP.out} onClick={onVoltar}>← Sair</button></div>
      </div>
      <div style={{ maxWidth: '900px', margin: '0 auto 4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {LISTA_VAGAS.filter(([v]) => !vagasFechadas.includes(v)).map(([v]) => {
          const novosNaVaga = candidatos.filter(x => x.vaga === v && isNovo(x)).length
          const labelCurto = v === 'csm-senior' ? 'CSM Sênior' : v === 'csm-latam' ? 'CSM LATAM' : v === 'salesops' ? 'Sales Ops' : v === 'copywriter-sr' ? 'Copywriter Sr.' : v === 'head-produto' ? 'Head de Produto' : 'AE B2B'
          return <button key={v} onClick={() => { setVagaAtiva(v); setAbaAtiva('triagem'); setExp(null); setFiltroStatus('todos') }} style={{ ...sP.abaBotao(vagaAtiva === v), fontSize: '13px', padding: '7px 16px', position: 'relative' }}>{labelCurto}{novosNaVaga > 0 && <span style={{ position: 'absolute', top: '-5px', right: '-5px', background: '#dc2626', color: 'white', borderRadius: '99px', padding: '1px 6px', fontSize: '10px', fontWeight: '700', lineHeight: '1.4' }}>{novosNaVaga}</span>}</button>
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <button onClick={() => { setAbaAtiva('feedback'); carregarFeedbacks() }} style={{ ...sP.abaBotao(abaAtiva === 'feedback'), fontSize: '13px', padding: '7px 16px' }}>💬 Feedback</button>
          <button onClick={() => setAbaAtiva('links')} style={{ ...sP.abaBotao(abaAtiva === 'links'), fontSize: '13px', padding: '7px 16px' }}>🔗 Links</button>
        </div>
      </div>
      {abaAtiva !== 'links' && abaAtiva !== 'feedback' && (
        <div style={{ maxWidth: '900px', margin: '8px auto 16px', display: 'flex', gap: '6px', borderBottom: '2px solid #e2e8f0', paddingBottom: '0' }}>
          {[['triagem', `📋 Triagem (${emTriagem.length})`], ['aprovados', `✅ Aprovados (${aprovados.length})`], ['reprovados', `❌ Reprovados (${reprovados.length})`]].map(([v, l]) => <button key={v} onClick={() => { setAbaAtiva(v); setExp(null) }} style={{ background: 'none', border: 'none', borderBottom: abaAtiva === v ? '2px solid #7c3aed' : '2px solid transparent', marginBottom: '-2px', padding: '8px 16px', fontSize: '13px', fontWeight: abaAtiva === v ? '700' : '500', color: abaAtiva === v ? '#7c3aed' : '#64748b', cursor: 'pointer' }}>{l}</button>)}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {abaAtiva === 'triagem' && <><span style={{ fontSize: '12px', color: '#94a3b8' }}>IA:</span>{[["todos", "Todos"], ["avanca", "✅"], ["talvez", "🟡"], ["nao", "❌"]].map(([v, l]) => <button key={v} onClick={() => setFiltroStatus(v)} style={{ ...sP.filtroBotao(filtroStatus === v), padding: '4px 10px', fontSize: '12px' }}>{l}</button>)}<span style={{ color: '#e2e8f0' }}>|</span></>}
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>Ordenar:</span>
            <select value={ordenacao} onChange={e => setOrdenacao(e.target.value)} style={{ fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', color: '#475569', background: 'white', cursor: 'pointer', outline: 'none' }}>
              <option value="data-desc">Mais recente</option><option value="data-asc">Mais antigo</option><option value="score-desc">Maior score</option><option value="score-asc">Menor score</option><option value="nome-asc">Nome A-Z</option><option value="nome-desc">Nome Z-A</option>
            </select>
          </div>
        </div>
      )}
      {abaAtiva === 'feedback' && <div style={{ maxWidth: '900px', margin: '0 auto' }}><div style={{ background: 'white', borderRadius: '12px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,.1)' }}><h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', marginBottom: '4px' }}>Feedbacks dos candidatos</h2><p style={{ fontSize: '13px', color: '#64748b', marginBottom: '24px' }}>Respostas anônimas coletadas ao final de cada entrevista.</p>{carregandoFeedbacks && <p style={{ color: '#7c3aed', fontSize: '13px' }}>Carregando...</p>}{!carregandoFeedbacks && feedbacks.length === 0 && <p style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>Nenhum feedback ainda.</p>}{feedbacks.map((f) => <div key={f.id} style={{ padding: '16px', background: '#f8fafc', borderRadius: '10px', marginBottom: '10px', border: '1px solid #e2e8f0' }}><div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}><span style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b' }}>{'⭐'.repeat(f.nota)}{'☆'.repeat(5-(f.nota||0))} <span style={{ color: '#7c3aed' }}>{f.nota}/5</span></span>{f.conforto && <span style={{ background: '#ede9fe', color: '#7c3aed', borderRadius: '99px', padding: '2px 10px', fontSize: '12px', fontWeight: '600' }}>{f.conforto}</span>}<span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: 'auto' }}>{vagaLabel(f.vaga)} · {f.data}</span></div>{f.comentario && <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: '1.6', fontStyle: 'italic' }}>"{f.comentario}"</p>}</div>)}</div></div>}
      {abaAtiva === 'links' && <div style={{ maxWidth: '900px', margin: '0 auto' }}><div style={{ background: 'white', borderRadius: '12px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,.1)' }}><h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', marginBottom: '6px' }}>Links para candidatos</h2><p style={{ fontSize: '13px', color: '#64748b', marginBottom: '24px' }}>Copie o link da vaga e envie diretamente para o candidato.</p>{LISTA_VAGAS.map(([id, titulo, bg, cor]) => { const url = `${window.location.origin}/?vaga=${id}`; return <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: '#f8fafc', borderRadius: '10px', marginBottom: '10px', border: '1px solid #e2e8f0' }}><span style={{ background: bg, color: cor, borderRadius: '99px', padding: '3px 12px', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>{titulo}</span><span style={{ flex: 1, fontSize: '13px', color: '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span><button onClick={() => { navigator.clipboard.writeText(url); alert('Link copiado!') }} style={{ background: '#7c3aed', color: 'white', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}>📋 Copiar</button></div> })}</div></div>}
      {abaAtiva !== 'links' && abaAtiva !== 'feedback' && listaAtiva.length === 0 && <div style={{ background: 'white', borderRadius: '12px', padding: '40px', maxWidth: '900px', margin: '0 auto', textAlign: 'center', color: '#64748b' }}>{abaAtiva === 'aprovados' ? 'Nenhum candidato aprovado ainda.' : abaAtiva === 'reprovados' ? 'Nenhum candidato reprovado.' : 'Nenhum candidato nessa categoria.'}</div>}
      {abaAtiva !== 'links' && abaAtiva !== 'feedback' && listaAtiva.map((x, i) => {
        const vc = VAGAS[x.vaga] || VAGAS['csm-senior']
        const estaReavaliando = reavaliando === x.id
        const estaPassando = passando === x.id
        return (
          <div key={x.id} style={sP.card} onClick={() => expandir(i, x)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '16px' }}>{x.nome}</strong>
                {isNovo(x) && <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626', flexShrink: 0 }} title="Novo" />}
                <span style={vagaBadgeStyle(x.vaga)}>{vagaLabel(x.vaga)}</span>
                <span style={{ color: '#94a3b8', fontSize: '13px' }}>{x.data}</span>
                {x.etapa === 'aprovado' && <span style={{ background: '#dcfce7', color: '#16a34a', borderRadius: '99px', padding: '2px 10px', fontSize: '11px', fontWeight: '700' }}>✅ Aprovado {x.dataAprovacao ? `em ${x.dataAprovacao}` : ''}</span>}
                {x.etapa === 'reprovado' && <span style={{ background: '#fee2e2', color: '#dc2626', borderRadius: '99px', padding: '2px 10px', fontSize: '11px', fontWeight: '700' }}>❌ Reprovado {x.dataReprovacao ? `em ${x.dataReprovacao}` : ''}</span>}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={S.sc(x.avaliacao?.score ?? 0)}>{x.avaliacao?.score != null ? `${x.avaliacao.score}/100` : '🎧 ouvir'}</span>
                <span style={{ fontSize: '18px' }}>{x.avaliacao?.classificacao?.split(' ')[0]}</span>
                <button onClick={(e) => deletar(x, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#dc2626', padding: '4px' }}>🗑</button>
              </div>
            </div>
            {exp === i && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                  <button style={{ ...sP.btnRoxo, opacity: estaReavaliando ? 0.6 : 1 }} onClick={(e) => reavaliar(x, e)} disabled={estaReavaliando}>{estaReavaliando ? '⏳ Reavaliando...' : '🤖 Reavaliar com IA'}</button>
                  {x.etapa !== 'aprovado' && x.etapa !== 'reprovado' && <><button style={{ ...sP.btnVerde, opacity: estaPassando ? 0.6 : 1 }} onClick={(e) => passarProximaEtapa(x, e)} disabled={estaPassando}>{estaPassando ? '⏳ Salvando...' : '✅ Passar pra próxima etapa'}</button><button style={{ ...sP.btnVermelho, opacity: reprovando === x.id ? 0.6 : 1 }} onClick={(e) => reprovar(x, e)} disabled={reprovando === x.id}>{reprovando === x.id ? '⏳ Salvando...' : '❌ Reprovar'}</button></>}
                  {(x.etapa === 'aprovado' || x.etapa === 'reprovado') && <button style={sP.btnCinza} onClick={(e) => voltarParaTriagem(x, e)}>↩ Voltar pra triagem</button>}
                </div>
                <p style={{ color: '#475569', fontSize: '14px', marginBottom: '12px', fontStyle: 'italic' }}>{x.avaliacao?.resumo}</p>
                {x.avaliacao?.pontos_fortes?.length > 0 && <div style={{ marginBottom: '12px' }}><strong style={{ fontSize: '13px', color: '#16a34a' }}>✅ Pontos fortes</strong><ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>{x.avaliacao.pontos_fortes.map((p, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{p}</li>)}</ul></div>}
                {x.avaliacao?.alertas?.length > 0 && <div style={{ marginBottom: '16px' }}><strong style={{ fontSize: '13px', color: '#dc2626' }}>⚠️ Alertas</strong><ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>{x.avaliacao.alertas.map((a, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{a}</li>)}</ul></div>}
                <strong style={{ fontSize: '13px', color: '#475569' }}>Respostas</strong>
                {carregandoAudio === x.id && <p style={{ fontSize: '13px', color: '#7c3aed', marginTop: '8px' }}>Carregando áudios...</p>}
                {x.respostas?.map((r, j) => {
                  const blobUrl = blobUrls[x.id]?.[j]; const audFallback = (audiosCarregados[x.id] || {})[j]; const srcAudio = blobUrl || audFallback || null
                  const audioKey = `${x.id}-${j}`
                  return (
                    <div key={j} style={{ marginTop: '12px', background: '#f8fafc', borderRadius: '8px', padding: '16px' }}>
                      <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>P{j + 1}: {vc.perguntas[j]}</p>
                      {srcAudio ? (
                        <div onClick={e => e.stopPropagation()}>
                          <audio id={audioKey} controls src={srcAudio} style={{ width: '100%', height: '36px' }} />
                          <div style={{ display: 'flex', gap: '4px', marginTop: '6px', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '2px' }}>velocidade:</span>
                            {[1, 1.5, 2, 2.5].map(v => (
                              <button key={v} onClick={e => { e.stopPropagation(); const el = document.getElementById(audioKey); if (el) el.playbackRate = v; e.currentTarget.parentNode.querySelectorAll('button').forEach(b => b.style.background = '#f1f5f9'); e.currentTarget.style.background = '#ede9fe' }}
                                style={{ border: 'none', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', background: v === 1 ? '#ede9fe' : '#f1f5f9', color: '#475569' }}>{v}x</button>
                            ))}
                          </div>
                        </div>
                      ) : x.errosAudio?.includes(j + 1) ? <p style={{ fontSize: '12px', color: '#dc2626', margin: 0 }}>⚠️ Áudio não salvo</p> : carregandoAudio !== x.id ? <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>Áudio não disponível</p> : null}
                      {r.duracao != null && <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#7c3aed' }}>⏱ {formatarTempo(r.duracao)}</p>}
                      {r.transcricao && <details onClick={e => e.stopPropagation()} style={{ marginTop: '8px' }}><summary style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer' }}>Ver transcrição</summary><p style={{ margin: '6px 0 0', fontSize: '13px', color: '#1e293b', lineHeight: '1.5' }}>{r.transcricao}</p></details>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function App() {
  const apiKey = import.meta.env.VITE_ANTHROPIC_KEY || ""
  const vagaId = getVagaFromUrl()
  if (!vagaId) return <Painel onVoltar={() => {}} apiKey={apiKey} />
  return <TelaCandidato apiKey={apiKey} vagaId={vagaId} onFinalizar={() => {}} />
}
