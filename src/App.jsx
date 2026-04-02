import { useState, useRef, useEffect, useCallback } from 'react'
import { db } from './firebase'
import { collection, addDoc, getDocs, orderBy, query, doc, deleteDoc, setDoc, updateDoc } from 'firebase/firestore'

const VAGAS = {
  'csm-senior': {
    titulo: 'Customer Success Manager Sênior',
    subtitulo: 'Gestão estratégica de contas B2B com foco em resultado e expansão',
    colecao: 'candidatos-csm-senior',
    perguntas: [
      "Me conta um caso em que você conectou o uso do produto com um resultado real de negócio do cliente. O que você mediu e como apresentou isso pra ele?",
      "Me descreve uma situação em que você identificou que um cliente ia embora antes de ele mesmo falar isso. O que você viu, o que fez e como terminou?",
      "Me conta um caso em que você identificou uma oportunidade de expansão a partir de um gap de resultado do cliente — não de uma meta de upsell. Como foi essa conversa?",
      "Me conta uma situação em que você precisou dizer a alguém — cliente, liderança ou parceiro — que a estratégia que estava sendo seguida não ia funcionar. Como você conduziu essa conversa?"
    ],
    criterios: `Critérios de avaliação:
1. Orientação ao resultado de negócio: conecta o uso do produto com métricas reais do cliente (receita, conversão, churn, ROI) — não fala só em adoção, NPS ou satisfação.
2. Proatividade e detecção de risco: identifica sinais de churn por dados ou comportamento antes do cliente verbalizar — age antes de virar crise.
3. Expansão consultiva: identifica oportunidades de expansão a partir de gaps reais de resultado — não a partir de metas de upsell ou pressão comercial.
4. Postura consultiva e desafio com respeito: tem segurança pra dizer que uma estratégia não vai funcionar e conduz essa conversa com dados e alternativa — não concorda pra evitar conflito.`
  }
}

const TEMPO_LIMITE = 300
const SENHA_PAINEL = "@Waid2626"

function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function formatarTempo(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const CHUNK_SIZE = 900000

function splitBase64(b64) {
  const chunks = []
  for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
    chunks.push(b64.slice(i, i + CHUNK_SIZE))
  }
  return chunks
}

function joinBase64(chunks) {
  return chunks.join('')
}

async function avaliarRespostas(apiKey, nome, vaga, respostas) {
  const config = VAGAS[vaga]
  const semTranscricao = respostas.every(r => !r.transcricao || r.transcricao.trim().length < 10)

  if (semTranscricao) {
    return {
      score: null,
      classificacao: "🎧 Ouvir áudio",
      pontos_fortes: [],
      alertas: ["Transcrição automática não capturou as respostas — isso pode acontecer por ruído no ambiente, uso de celular ou microfone com permissão parcial."],
      resumo: "Não foi possível avaliar automaticamente. Ouça os áudios diretamente no painel para fazer sua avaliação."
    }
  }

  const prompt = `Você é um recrutador sênior da Curseduca avaliando candidatos para uma vaga exigente de Customer Success Manager Sênior B2B. Seu papel é ser criterioso — a maioria dos candidatos NÃO deve passar nessa triagem.

Candidato: "${nome}"

${respostas.map((r, i) => `Pergunta ${i + 1}: ${config.perguntas[i]}\nResposta: ${r.transcricao && r.transcricao.trim().length > 10 ? r.transcricao : '[transcrição não capturada]'}\n`).join('\n')}

${config.criterios}

REGRAS DE AVALIAÇÃO DE CONTEÚDO (aplique com rigor):
- Exija exemplos concretos e específicos. Respostas genéricas como "eu sempre acompanho os clientes de perto" ou "costumo ser proativo" sem caso real = alerta grave.
- Exija métricas ou resultados tangíveis quando a pergunta pede. Quem fala só em processo ("fiz reunião", "montei plano de ação") sem resultado mensurável perde pontos significativos.
- Detecção de churn: exija sinais concretos que o candidato identificou (dados, comportamento, frequência de uso, ticket aberto, etc.) — não aceite "percebi que o cliente estava insatisfeito" sem evidência.
- Expansão: exija que a oportunidade tenha vindo de um gap real de resultado do cliente, não de uma meta interna. Se soar como upsell disfarçado, aponte.
- Postura consultiva: exija que o candidato tenha apresentado dado ou argumento sólido ao discordar — não só "dei minha opinião com respeito".

REGRAS DE FORMA (seja tolerante):
- Transcrições automáticas têm erros de pontuação, palavras trocadas e frases incompletas — ignore completamente. Foque no raciocínio, não na gramática.
- Respostas longas ou detalhadas são normais em áudio — NÃO penalize extensão. Só registre como alerta se a resposta for completamente circular e vazia após ouvir tudo.
- Se uma transcrição estiver '[transcrição não capturada]', não penalize — registre que o áudio precisa ser ouvido manualmente.

CALIBRAÇÃO DE SCORE:
- 80-100: demonstrou todos os critérios com exemplos concretos e métricas. Raro.
- 65-79: demonstrou a maioria dos critérios com substância, mas faltou profundidade em 1-2 pontos.
- 50-64: demonstrou alguns critérios mas com respostas genéricas ou sem métricas na maior parte.
- abaixo de 50: respostas majoritariamente genéricas, sem exemplos reais, ou sem aderência ao perfil sênior B2B.

CLASSIFICAÇÃO:
- ✅ Avança: score ≥ 72 E demonstrou pelo menos 3 dos 4 critérios com substância real.
- 🟡 Talvez: score entre 58-71, ou score ≥ 72 mas com gap importante em critério essencial.
- ❌ Não avança: score < 58, ou respostas predominantemente genéricas independente do score.

Responda APENAS em JSON válido:
{"score":<0-100>,"classificacao":"<✅ Avança | 🟡 Talvez | ❌ Não avança>","pontos_fortes":["..."],"alertas":["..."],"resumo":"<2 frases>"}`

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    const text = data.content?.[0]?.text || "{}"
    return JSON.parse(text.replace(/```json|```/g, "").trim())
  } catch {
    return { score: 50, classificacao: "🟡 Talvez", pontos_fortes: [], alertas: ["Avaliação automática indisponível"], resumo: "Avalie manualmente ouvindo os áudios." }
  }
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
  audio: { width: '100%', borderRadius: '8px', marginTop: '12px' },
  sc: (n) => ({ display: 'inline-block', background: n >= 70 ? '#dcfce7' : n >= 50 ? '#fef9c3' : '#fee2e2', color: n >= 70 ? '#16a34a' : n >= 50 ? '#ca8a04' : '#dc2626', borderRadius: '99px', padding: '4px 14px', fontSize: '13px', fontWeight: '700' })
}

// ─── TELA CANDIDATO ──────────────────────────────────────────────────────────

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
  const [revisando, setRevisando] = useState(false)
  const [reviewUrls, setReviewUrls] = useState([])
  const mediaRecRef = useRef(null)
  const chunksRef = useRef([])
  const speechRef = useRef(null)
  const timerRef = useRef(null)
  const transcricaoRef = useRef("")

  const limparEstado = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null); setAudioUrl(null); setTranscricao(""); setTempoRestante(TEMPO_LIMITE); transcricaoRef.current = ""
  }, [audioUrl])

  const pararGravacao = useCallback(() => {
    setGravando(false)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') { try { mediaRecRef.current.stop() } catch {} }
    if (speechRef.current) { try { speechRef.current.stop() } catch {}; speechRef.current = null }
  }, [])

  useEffect(() => { return () => { pararGravacao() } }, [pararGravacao])
  useEffect(() => {
    return () => { reviewUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch {} }) }
  }, [reviewUrls])

  const iniciarGravacao = async () => {
    limparEstado()
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    catch { alert("Permissão de microfone negada. Clique no ícone de cadeado na barra do navegador e permita o acesso ao microfone."); return }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
      setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob)); setTranscricao(transcricaoRef.current)
    }
    mediaRecRef.current = mr; mr.start(1000)

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SR) {
      const sr = new SR(); sr.lang = 'pt-BR'; sr.continuous = true; sr.interimResults = true
      let ft = ""
      sr.onresult = (e) => {
        const f = Array.from(e.results).filter(x => x.isFinal).map(x => x[0].transcript).join(' ')
        const int = Array.from(e.results).filter(x => !x.isFinal).map(x => x[0].transcript).join(' ')
        ft = f; transcricaoRef.current = ft; setTranscricao(ft + (int ? ' ' + int : ''))
      }
      sr.onerror = () => {}; sr.onend = () => { transcricaoRef.current = ft }
      speechRef.current = sr; try { sr.start() } catch {}
    }

    setTempoRestante(TEMPO_LIMITE); setGravando(true)
    timerRef.current = setInterval(() => {
      setTempoRestante(prev => { if (prev <= 1) { pararGravacao(); return 0 }; return prev - 1 })
    }, 1000)
  }

  const regravar = () => { limparEstado() }

  const salvarRespostaAtual = (blob, transcrAtual, tempoAtual, arr) => {
    const novas = [...arr]
    novas[pergAtual] = { blob, transcricao: transcrAtual, duracao: TEMPO_LIMITE - tempoAtual }
    return novas
  }

  const avancar = () => {
    if (!audioBlob) return
    const novas = salvarRespostaAtual(audioBlob, transcricaoRef.current || transcricao, tempoRestante, respostas)
    setRespostas(novas)
    if (pergAtual + 1 < config.perguntas.length) {
      limparEstado(); setPergAtual(pergAtual + 1)
    } else {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioBlob(null); setAudioUrl(null); setTranscricao(""); transcricaoRef.current = ""
      const urls = novas.map(r => URL.createObjectURL(r.blob))
      setReviewUrls(urls); setRevisando(true)
    }
  }

  const voltar = () => {
    if (gravando) pararGravacao()
    let novas = respostas
    if (audioBlob) {
      novas = salvarRespostaAtual(audioBlob, transcricaoRef.current || transcricao, tempoRestante, respostas)
      setRespostas(novas)
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    const prev = novas[pergAtual - 1]
    if (prev) {
      setAudioBlob(prev.blob); setAudioUrl(URL.createObjectURL(prev.blob))
      setTranscricao(prev.transcricao); transcricaoRef.current = prev.transcricao
      setTempoRestante(TEMPO_LIMITE - prev.duracao)
    } else {
      setAudioBlob(null); setAudioUrl(null); setTranscricao(""); transcricaoRef.current = ""; setTempoRestante(TEMPO_LIMITE)
    }
    setPergAtual(pergAtual - 1)
  }

  const voltarDaRevisao = () => {
    reviewUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch {} })
    setReviewUrls([]); setRevisando(false)
    const ultima = respostas[respostas.length - 1]
    if (ultima) {
      setAudioBlob(ultima.blob); setAudioUrl(URL.createObjectURL(ultima.blob))
      setTranscricao(ultima.transcricao); transcricaoRef.current = ultima.transcricao
      setTempoRestante(TEMPO_LIMITE - ultima.duracao)
    }
    setPergAtual(config.perguntas.length - 1)
  }

  const finalizarEnvio = async (todas) => {
    setEnviando(true)
    try {
      const resSemAudio = todas.map((r, i) => ({ pergunta: i, transcricao: r.transcricao, duracao: r.duracao }))
      const aval = await avaliarRespostas(apiKey, nome, vagaId, todas)
      const docRef = await addDoc(collection(db, config.colecao), {
        nome, candidatoId, vaga: vagaId, respostas: resSemAudio, avaliacao: aval,
        etapa: 'triagem',
        data: new Date().toLocaleDateString("pt-BR"), timestamp: new Date()
      })
      const errosAudio = []
      for (let i = 0; i < todas.length; i++) {
        try {
          const b64 = await blobToBase64(todas[i].blob)
          const chunks = splitBase64(b64)
          await setDoc(doc(db, config.colecao, docRef.id, "audios", `pergunta-${i}`), {
            pergunta: i, duracao: todas[i].duracao, totalChunks: chunks.length,
            ...(chunks.length === 1 ? { audioBase64: b64 } : {})
          })
          if (chunks.length > 1) {
            for (let c = 0; c < chunks.length; c++) {
              await setDoc(doc(db, config.colecao, docRef.id, "audios", `pergunta-${i}-chunk-${c}`), { pergunta: i, chunk: c, data: chunks[c] })
            }
          }
        } catch { errosAudio.push(i + 1) }
      }
      if (errosAudio.length > 0) await setDoc(doc(db, config.colecao, docRef.id), { errosAudio }, { merge: true })
      setConcluido(true); onFinalizar()
    } catch (err) { alert("Erro ao enviar: " + err.message); setEnviando(false) }
  }

  if (concluido) return (
    <div style={S.page}><div style={{ ...S.box, textAlign: 'center' }}>
      <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
      <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a' }}>Entrevista concluída!</h2>
      <p style={{ color: '#64748b', marginTop: '8px' }}>Obrigado, {nome}! Nossa equipe vai ouvir suas respostas e entrará em contato em breve.</p>
    </div></div>
  )

  if (enviando) return (
    <div style={S.page}><div style={{ ...S.box, textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
      <h2 style={{ fontSize: '22px', fontWeight: '700' }}>Enviando suas respostas...</h2>
      <p style={{ color: '#64748b', marginTop: '8px' }}>Estamos salvando seus áudios e analisando suas respostas. Não feche a página.</p>
    </div></div>
  )

  if (revisando) return (
    <div style={S.page}><div style={S.box}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div style={{ fontSize: '40px', marginBottom: '8px' }}>🎧</div>
        <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>Revise suas respostas</h2>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Ouça antes de enviar. Se quiser regravar, use o botão voltar.</p>
      </div>
      {respostas.map((r, i) => (
        <div key={i} style={{ background: '#f8fafc', borderRadius: '12px', padding: '16px', marginBottom: '16px', borderLeft: '4px solid #7c3aed' }}>
          <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: '700', color: '#7c3aed' }}>Pergunta {i + 1}</p>
          <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#1e293b', lineHeight: '1.5' }}>{config.perguntas[i]}</p>
          <audio controls src={reviewUrls[i]} style={{ width: '100%', borderRadius: '8px' }} />
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#7c3aed' }}>⏱ Duração: {formatarTempo(r.duracao)}</p>
          {r.transcricao && (
            <details style={{ marginTop: '8px' }}>
              <summary style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer' }}>Ver transcrição automática</summary>
              <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>{r.transcricao}</p>
            </details>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
        <button style={{ ...S.btnSm, background: '#f1f5f9', color: '#475569', flex: 1, padding: '14px' }} onClick={voltarDaRevisao}>← Voltar</button>
        <button style={{ ...S.btn, marginTop: 0, flex: 2 }} onClick={() => finalizarEnvio(respostas)}>Enviar entrevista ✓</button>
      </div>
    </div></div>
  )

  if (!iniciado) return (
    <div style={S.page}><div style={S.box}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎤</div>
        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>{config.titulo}</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Curseduca • Entrevista por Áudio</p>
      </div>
      <div style={S.aviso}>
        <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Olá! Essa é uma etapa do nosso processo seletivo feita por áudio.</p>
        <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Você vai responder <strong>{config.perguntas.length} perguntas</strong> gravando sua voz. Cada resposta tem um limite de <strong>5 minutos</strong>. Nosso time vai ouvir suas respostas diretamente.</p>
        <p style={{ margin: 0, fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Responda com naturalidade, como se estivesse em uma conversa. Seja direto(a) e objetivo(a). 🙌</p>
      </div>
      <div style={S.avisoAmarelo}>
        <p style={{ margin: 0, fontSize: '13px', color: '#92400e', lineHeight: '1.6' }}>
          ⚠️ <strong>Sobre a transcrição automática:</strong> o sistema pode não capturar todas as palavras corretamente — e tudo bem! O time de Gente & Cultura vai <strong>ouvir os áudios</strong> diretamente. Fale com tranquilidade. 🎧
        </p>
      </div>
      <p style={{ color: '#475569', marginBottom: '24px', lineHeight: '1.6', fontSize: '14px' }}>Use <strong>Google Chrome</strong> no computador para melhor experiência. Certifique-se de estar em um ambiente silencioso.</p>
      <input style={S.inp} placeholder="Seu nome completo" value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && nome.trim() && setIniciado(true)} />
      <button style={{ ...S.btn, opacity: nome.trim() ? 1 : .5 }} onClick={() => nome.trim() && setIniciado(true)}>Começar →</button>
    </div></div>
  )

  const temAudio = !!audioBlob, danger = gravando && tempoRestante <= 30
  const isUltima = pergAtual + 1 === config.perguntas.length

  return (
    <div style={S.page}><div style={S.box}>
      <span style={S.badge}>Pergunta {pergAtual + 1} de {config.perguntas.length}</span>
      <div style={S.bar}><div style={S.barIn((pergAtual / config.perguntas.length) * 100)} /></div>
      <div style={S.qbox}><p style={{ margin: 0, fontSize: '17px', fontWeight: '600', color: '#1e293b', lineHeight: '1.5' }}>{config.perguntas[pergAtual]}</p></div>
      <div style={{ background: '#fffbeb', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', borderLeft: '3px solid #f59e0b' }}>
        <p style={{ margin: 0, fontSize: '12px', color: '#92400e', lineHeight: '1.6' }}>💡 <strong>Dica:</strong> grave em um local silencioso, fale próximo ao microfone e acompanhe a transcrição aparecendo na tela — se não aparecer nada enquanto fala, pause e verifique se o microfone está ativo.</p>
      </div>
      {(gravando || temAudio) && (
        <div style={S.timer(danger)}>
          {gravando && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#dc2626', animation: 'pulse 1s infinite' }} />}
          {gravando ? `${formatarTempo(tempoRestante)} restantes` : `Duração: ${formatarTempo(TEMPO_LIMITE - tempoRestante)}`}
        </div>
      )}
      {temAudio && !gravando && (
        <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '600', color: '#475569' }}>🔊 Ouça sua resposta:</p>
          <audio controls src={audioUrl} style={S.audio} />
          {transcricao && (<details style={{ marginTop: '12px' }}><summary style={{ fontSize: '13px', color: '#7c3aed', cursor: 'pointer' }}>Ver transcrição automática</summary><p style={{ margin: '8px 0 0', fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>{transcricao}</p></details>)}
        </div>
      )}
      {gravando && transcricao && (
        <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px', marginBottom: '16px', border: '1px solid #e2e8f0' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>{transcricao}</p>
        </div>
      )}
      <div style={S.row}>
        {!gravando && pergAtual > 0 && (
          <button style={{ ...S.btnSm, background: '#f1f5f9', color: '#475569' }} onClick={voltar}>← Voltar</button>
        )}
        {!gravando && !temAudio && (
          <button style={{ ...S.btn, marginTop: 0, flex: 1 }} onClick={iniciarGravacao}>🎙 Gravar resposta</button>
        )}
        {gravando && (
          <button style={{ ...S.btnSm, background: '#dc2626', color: 'white', flex: 1 }} onClick={pararGravacao}>⏹ Parar gravação</button>
        )}
        {temAudio && !gravando && (<>
          <button style={{ ...S.btnSm, background: '#f1f5f9', color: '#475569' }} onClick={regravar}>🔄 Regravar</button>
          <button style={{ ...S.btn, marginTop: 0, flex: 1 }} onClick={avancar}>
            {isUltima ? 'Revisar respostas →' : 'Próxima →'}
          </button>
        </>)}
        {temAudio && !gravando && !transcricao && (
          <p style={{ width: '100%', margin: '8px 0 0', fontSize: '12px', color: '#dc2626', textAlign: 'center' }}>⚠️ Transcrição não capturada — considere regravar em local mais silencioso ou verificar o microfone.</p>
        )}
      </div>
    </div><style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.3 } }`}</style></div>
  )
}

// ─── PAINEL ──────────────────────────────────────────────────────────────────

function Painel({ onVoltar, apiKey }) {
  const [senha, setSenha] = useState("")
  const [auth, setAuth] = useState(false)
  const [candidatos, setCandidatos] = useState([])
  const [exp, setExp] = useState(null)
  const [audiosCarregados, setAudiosCarregados] = useState({})
  const [carregandoAudio, setCarregandoAudio] = useState(null)
  const [filtroStatus, setFiltroStatus] = useState("todos")
  const [abaAtiva, setAbaAtiva] = useState("triagem") // 'triagem' | 'aprovados'
  const [carregando, setCarregando] = useState(false)
  const [reavaliando, setReavaliando] = useState(null)
  const [passando, setPassando] = useState(null)

  const carregarCandidatos = async () => {
    setCarregando(true)
    try {
      const todos = []
      for (const [vId, cfg] of Object.entries(VAGAS)) {
        const q = query(collection(db, cfg.colecao), orderBy("timestamp", "desc"))
        const snap = await getDocs(q)
        snap.docs.forEach(d => todos.push({ id: d.id, colecao: cfg.colecao, ...d.data() }))
      }
      todos.sort((a, b) => (b.timestamp?.toDate?.() || 0) - (a.timestamp?.toDate?.() || 0))
      setCandidatos(todos)
    } catch (e) { alert("Erro ao carregar: " + e.message) }
    setCarregando(false)
  }

  const carregarAudios = async (c) => {
    if (audiosCarregados[c.id]) return
    setCarregandoAudio(c.id)
    try {
      const snap = await getDocs(collection(db, c.colecao, c.id, "audios"))
      const docs = {}
      snap.docs.forEach(d => { docs[d.id] = d.data() })
      const a = {}
      const perguntas = new Set(Object.values(docs).map(d => d.pergunta).filter(p => p !== undefined))
      for (const p of perguntas) {
        const meta = docs[`pergunta-${p}`]
        if (!meta) continue
        if (meta.audioBase64) {
          a[p] = meta.audioBase64
        } else if (meta.totalChunks > 1) {
          const parts = []
          for (let c2 = 0; c2 < meta.totalChunks; c2++) {
            const chunkDoc = docs[`pergunta-${p}-chunk-${c2}`]
            if (chunkDoc) parts.push(chunkDoc.data)
          }
          if (parts.length === meta.totalChunks) a[p] = joinBase64(parts)
        }
      }
      setAudiosCarregados(prev => ({ ...prev, [c.id]: a }))
    } catch { setAudiosCarregados(prev => ({ ...prev, [c.id]: {} })) }
    setCarregandoAudio(null)
  }

  const reavaliar = async (c, e) => {
    e.stopPropagation()
    if (!c.respostas) return
    setReavaliando(c.id)
    try {
      const novaAval = await avaliarRespostas(apiKey, c.nome, c.vaga || 'csm-senior', c.respostas)
      await updateDoc(doc(db, c.colecao, c.id), { avaliacao: novaAval })
      setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, avaliacao: novaAval } : x))
    } catch (err) { alert("Erro ao reavaliar: " + err.message) }
    setReavaliando(null)
  }

  const passarProximaEtapa = async (c, e) => {
    e.stopPropagation()
    if (!confirm(`Passar ${c.nome} para a próxima etapa?`)) return
    setPassando(c.id)
    try {
      await updateDoc(doc(db, c.colecao, c.id), { etapa: 'aprovado', dataAprovacao: new Date().toLocaleDateString("pt-BR") })
      setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, etapa: 'aprovado', dataAprovacao: new Date().toLocaleDateString("pt-BR") } : x))
      setExp(null)
    } catch (err) { alert("Erro: " + err.message) }
    setPassando(null)
  }

  const voltarParaTriagem = async (c, e) => {
    e.stopPropagation()
    try {
      await updateDoc(doc(db, c.colecao, c.id), { etapa: 'triagem' })
      setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, etapa: 'triagem' } : x))
      setExp(null)
    } catch (err) { alert("Erro: " + err.message) }
  }

  useEffect(() => { if (auth) carregarCandidatos() }, [auth])

  const expandir = (i, c) => { if (exp === i) { setExp(null) } else { setExp(i); carregarAudios(c) } }

  const deletar = async (c, e) => {
    e.stopPropagation()
    if (!confirm(`Apagar ${c.nome}?`)) return
    try {
      const aSnap = await getDocs(collection(db, c.colecao, c.id, "audios"))
      for (const ad of aSnap.docs) { await deleteDoc(doc(db, c.colecao, c.id, "audios", ad.id)) }
      await deleteDoc(doc(db, c.colecao, c.id))
      setCandidatos(prev => prev.filter(x => x.id !== c.id))
      setAudiosCarregados(prev => { const n = { ...prev }; delete n[c.id]; return n })
    } catch (e) { alert("Erro: " + e.message) }
  }

  const sP = {
    page: { minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', padding: '32px 20px' },
    card: { background: 'white', borderRadius: '12px', padding: '20px', maxWidth: '900px', margin: '0 auto 16px', boxShadow: '0 1px 3px rgba(0,0,0,.1)', cursor: 'pointer' },
    btn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    btnVerde: { background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    btnCinza: { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    btnRoxo: { background: '#ede9fe', color: '#7c3aed', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    out: { background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' },
    inp: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', outline: 'none', marginBottom: '16px' },
    vb: { display: 'inline-block', background: '#ede9fe', color: '#7c3aed', borderRadius: '99px', padding: '2px 10px', fontSize: '11px', fontWeight: '600' },
    abaBotao: (ativa) => ({ background: ativa ? '#7c3aed' : 'white', color: ativa ? 'white' : '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' })
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

  const emTriagem = candidatos.filter(x => !x.etapa || x.etapa === 'triagem')
  const aprovados = candidatos.filter(x => x.etapa === 'aprovado')

  let listaAtiva = abaAtiva === 'triagem' ? emTriagem : aprovados
  if (abaAtiva === 'triagem' && filtroStatus !== "todos") {
    listaAtiva = listaAtiva.filter(x => x.avaliacao?.classificacao?.includes(
      filtroStatus === "avanca" ? "Avança" : filtroStatus === "talvez" ? "Talvez" : "Não avança"
    ))
  }

  return (
    <div style={sP.page}>
      {/* Header */}
      <div style={{ maxWidth: '900px', margin: '0 auto 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a' }}>Painel G&C — Entrevistas por Áudio</h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>{emTriagem.length} em triagem · {aprovados.length} aprovado(s)</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={sP.btn} onClick={carregarCandidatos} disabled={carregando}>{carregando ? "Carregando..." : "🔄 Atualizar"}</button>
          <button style={sP.out} onClick={onVoltar}>← Voltar</button>
        </div>
      </div>

      {/* Abas */}
      <div style={{ maxWidth: '900px', margin: '0 auto 20px', display: 'flex', gap: '8px' }}>
        <button style={sP.abaBotao(abaAtiva === 'triagem')} onClick={() => { setAbaAtiva('triagem'); setExp(null) }}>
          📋 Triagem ({emTriagem.length})
        </button>
        <button style={sP.abaBotao(abaAtiva === 'aprovados')} onClick={() => { setAbaAtiva('aprovados'); setExp(null) }}>
          ✅ Aprovados ({aprovados.length})
        </button>
      </div>

      {/* Filtros — só na aba triagem */}
      {abaAtiva === 'triagem' && (
        <div style={{ maxWidth: '900px', margin: '0 auto 20px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#64748b', marginRight: '4px' }}>IA:</span>
          {[["todos", "Todos"], ["avanca", "✅ Avança"], ["talvez", "🟡 Talvez"], ["nao", "❌ Não avança"]].map(([v, l]) => (
            <button key={v} onClick={() => setFiltroStatus(v)} style={{ ...sP.btn, background: filtroStatus === v ? '#7c3aed' : 'white', color: filtroStatus === v ? 'white' : '#475569', border: '1px solid #e2e8f0', padding: '6px 14px', fontSize: '13px' }}>{l}</button>
          ))}
        </div>
      )}

      {/* Lista */}
      {listaAtiva.length === 0 && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '40px', maxWidth: '900px', margin: '0 auto', textAlign: 'center', color: '#64748b' }}>
          {abaAtiva === 'aprovados' ? 'Nenhum candidato aprovado ainda.' : 'Nenhum candidato nessa categoria.'}
        </div>
      )}

      {listaAtiva.map((x, i) => {
        const vc = VAGAS[x.vaga] || VAGAS['csm-senior']
        const aud = audiosCarregados[x.id] || {}
        const estaReavaliando = reavaliando === x.id
        const estaPassando = passando === x.id

        return (
          <div key={x.id} style={sP.card} onClick={() => expandir(i, x)}>
            {/* Linha principal do card */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '16px' }}>{x.nome}</strong>
                <span style={sP.vb}>CSM Sênior</span>
                <span style={{ color: '#94a3b8', fontSize: '13px' }}>{x.data}</span>
                {x.etapa === 'aprovado' && (
                  <span style={{ background: '#dcfce7', color: '#16a34a', borderRadius: '99px', padding: '2px 10px', fontSize: '11px', fontWeight: '700' }}>
                    ✅ Aprovado {x.dataAprovacao ? `em ${x.dataAprovacao}` : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={S.sc(x.avaliacao?.score ?? 0)}>{x.avaliacao?.score != null ? `${x.avaliacao.score}/100` : '🎧 ouvir'}</span>
                <span style={{ fontSize: '18px' }}>{x.avaliacao?.classificacao?.split(' ')[0]}</span>
                <button onClick={(e) => deletar(x, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#dc2626', padding: '4px' }} title="Apagar">🗑</button>
              </div>
            </div>

            {/* Conteúdo expandido */}
            {exp === i && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                {/* Botões de ação */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                  <button
                    style={{ ...sP.btnRoxo, opacity: estaReavaliando ? 0.6 : 1 }}
                    onClick={(e) => reavaliar(x, e)}
                    disabled={estaReavaliando}
                  >
                    {estaReavaliando ? '⏳ Reavaliando...' : '🤖 Reavaliar com IA'}
                  </button>

                  {x.etapa !== 'aprovado' ? (
                    <button
                      style={{ ...sP.btnVerde, opacity: estaPassando ? 0.6 : 1 }}
                      onClick={(e) => passarProximaEtapa(x, e)}
                      disabled={estaPassando}
                    >
                      {estaPassando ? '⏳ Salvando...' : '✅ Passar pra próxima etapa'}
                    </button>
                  ) : (
                    <button style={sP.btnCinza} onClick={(e) => voltarParaTriagem(x, e)}>
                      ↩ Voltar pra triagem
                    </button>
                  )}
                </div>

                {/* Avaliação IA */}
                <p style={{ color: '#475569', fontSize: '14px', marginBottom: '12px', fontStyle: 'italic' }}>{x.avaliacao?.resumo}</p>
                {x.avaliacao?.pontos_fortes?.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <strong style={{ fontSize: '13px', color: '#16a34a' }}>✅ Pontos fortes</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
                      {x.avaliacao.pontos_fortes.map((p, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{p}</li>)}
                    </ul>
                  </div>
                )}
                {x.avaliacao?.alertas?.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <strong style={{ fontSize: '13px', color: '#dc2626' }}>⚠️ Alertas</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
                      {x.avaliacao.alertas.map((a, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{a}</li>)}
                    </ul>
                  </div>
                )}

                {/* Áudios */}
                <strong style={{ fontSize: '13px', color: '#475569' }}>Respostas</strong>
                {carregandoAudio === x.id && <p style={{ fontSize: '13px', color: '#7c3aed', marginTop: '8px' }}>Carregando áudios...</p>}
                {x.respostas?.map((r, j) => (
                  <div key={j} style={{ marginTop: '12px', background: '#f8fafc', borderRadius: '8px', padding: '16px' }}>
                    <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>P{j + 1}: {vc.perguntas[j] || 'Pergunta não disponível'}</p>
                    {aud[j]
                      ? <div style={{ marginBottom: '8px' }} onClick={e => e.stopPropagation()}><audio controls src={aud[j]} style={{ width: '100%', height: '36px' }} /></div>
                      : x.errosAudio?.includes(j + 1)
                        ? <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#dc2626' }}>⚠️ Áudio não salvo — erro no envio</p>
                        : carregandoAudio !== x.id
                          ? <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#94a3b8' }}>Áudio não disponível</p>
                          : null
                    }
                    {r.duracao != null && <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#7c3aed' }}>⏱ Duração: {formatarTempo(r.duracao)}</p>}
                    {r.transcricao && (
                      <details onClick={e => e.stopPropagation()}>
                        <summary style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer' }}>Ver transcrição</summary>
                        <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#1e293b', lineHeight: '1.5' }}>{r.transcricao}</p>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── APP ROOT ────────────────────────────────────────────────────────────────

export default function App() {
  const [tela, setTela] = useState("candidato")
  const apiKey = import.meta.env.VITE_ANTHROPIC_KEY || ""

  if (tela === "painel") return <Painel onVoltar={() => setTela("candidato")} apiKey={apiKey} />

  return (
    <div style={{ position: "relative" }}>
      <TelaCandidato apiKey={apiKey} vagaId="csm-senior" onFinalizar={() => {}} />
      <button onClick={() => setTela("painel")} style={{ position: "fixed", bottom: "16px", right: "16px", background: "#1e293b", color: "white", border: "none", borderRadius: "8px", padding: "10px 18px", fontSize: "13px", fontWeight: "600", cursor: "pointer", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,.3)" }}>🔒 Painel G&C</button>
    </div>
  )
}
