import { useState, useRef, useEffect, useCallback } from 'react'
import { db } from './firebase'
import { collection, addDoc, getDocs, orderBy, query, doc, deleteDoc, setDoc } from 'firebase/firestore'

const VAGAS = {
  'cs-senior': {
    titulo: 'Customer Success Manager — Pleno/Sênior',
    subtitulo: 'Gestão de carteira estratégica com foco em retenção e expansão',
    colecao: 'candidatos-cs-senior',
    perguntas: [
      "Me explica, de forma direta, o que um CS faz no dia a dia — sem falar em atendimento ou suporte.",
      "Me conta uma situação em que você olhou pros dados da sua carteira, identificou um problema antes de virar crise e agiu. O que você viu, o que fez e qual foi o resultado?",
      "Me dá um exemplo de uma conversa difícil com um cliente — pode ser renovação, realinhamento de expectativa ou uma situação de conflito. Como você conduziu?"
    ],
    criterios: `Critérios de avaliação:
1. Visão estratégica de CS: entende o papel como gestão de resultado (retenção, expansão, saúde da carteira) — não reduz a atendimento ou suporte.
2. Raciocínio analítico com ação: usa dados reais (churn, NPS, health score, MRR) pra identificar problemas e agir antes de virar crise — não apenas reporta.
3. Negociação e autonomia: conduz conversas difíceis com clientes (renovação, realinhamento, conflito), toma decisão e chega em solução — não escala tudo pro gestor.
4. Clareza e síntese: responde de forma direta, objetiva e bem articulada dentro do limite de 5 minutos — quem enrola ou é vago perde pontos.
5. Experiência B2B SaaS: demonstra vivência real com gestão de carteira em empresas B2B, preferencialmente SaaS.`
  },
  'cs-b2b': {
    titulo: 'Customer Success B2B — Key Account',
    subtitulo: 'Gestão de contas grandes com relacionamento C-level',
    colecao: 'candidatos-cs-b2b',
    perguntas: [
      "Me conta como você construiu relacionamento com um cliente de alto nível — diretor ou C-level. Como você gerou confiança e se posicionou como parceiro estratégico, não só como ponto de contato?",
      "Me descreve um momento em que você estava com várias contas grandes demandando ao mesmo tempo e a pressão aumentou. Como você priorizou, o que fez pra não deixar bola cair e como lidou com a pressão?",
      "Me conta um caso em que um cliente grande estava insatisfeito ou próximo de sair. O que você fez pra reverter a situação e manter a conta?"
    ],
    criterios: `Critérios de avaliação:
1. Postura com C-level: tem presença, confiança e maturidade pra lidar com diretores e executivos — se posiciona como parceiro estratégico, não como operacional.
2. Organização e resiliência sob pressão: gerencia múltiplas contas grandes simultaneamente sem perder prazo, contexto ou qualidade — descreve processo e critério de priorização, não apenas "trabalhei mais".
3. Retenção por relacionamento: segura contas por confiança, valor e ação estratégica — não por desconto ou concessão.
4. Clareza e síntese: responde de forma direta, objetiva e bem articulada dentro do limite de 5 minutos — quem enrola ou é vago perde pontos.
5. Experiência com contas enterprise: demonstra vivência real com clientes de alto ticket e ciclos de relacionamento longos.`
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

async function avaliarRespostas(apiKey, nome, vaga, respostas) {
  const config = VAGAS[vaga]
  const prompt = `Você é um recrutador especialista da Curseduca, uma EdTech brasileira em crescimento.
Avalie as respostas (transcritas de áudio) do candidato "${nome}" para a vaga de ${config.titulo}.

${respostas.map((r, i) => `Pergunta ${i + 1}: ${config.perguntas[i]}\nResposta (transcrição do áudio): ${r.transcricao || '[sem transcrição disponível]'}\n`).join('\n')}

${config.criterios}

IMPORTANTE: As respostas foram transcritas automaticamente de áudio, então pode haver pequenos erros de transcrição. Avalie o conteúdo e a qualidade do raciocínio, não a gramática da transcrição.

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

  const avancar = () => {
    if (!audioBlob) return
    const nova = { blob: audioBlob, transcricao: transcricaoRef.current || transcricao, duracao: TEMPO_LIMITE - tempoRestante }
    const novas = [...respostas, nova]; setRespostas(novas); limparEstado()
    if (pergAtual + 1 < config.perguntas.length) { setPergAtual(pergAtual + 1) }
    else { finalizarEnvio(novas) }
  }

  const finalizarEnvio = async (todas) => {
    setEnviando(true)
    try {
      const resSemAudio = todas.map((r, i) => ({ pergunta: i, transcricao: r.transcricao, duracao: r.duracao }))
      const aval = await avaliarRespostas(apiKey, nome, vagaId, todas)
      const docRef = await addDoc(collection(db, config.colecao), {
        nome, candidatoId, vaga: vagaId, respostas: resSemAudio, avaliacao: aval,
        data: new Date().toLocaleDateString("pt-BR"), timestamp: new Date()
      })
      for (let i = 0; i < todas.length; i++) {
        try {
          const b64 = await blobToBase64(todas[i].blob)
          await setDoc(doc(db, config.colecao, docRef.id, "audios", `pergunta-${i}`), { pergunta: i, audioBase64: b64, duracao: todas[i].duracao })
        } catch {}
      }
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
  return (
    <div style={S.page}><div style={S.box}>
      <span style={S.badge}>Pergunta {pergAtual + 1} de {config.perguntas.length}</span>
      <div style={S.bar}><div style={S.barIn((pergAtual / config.perguntas.length) * 100)} /></div>
      <div style={S.qbox}><p style={{ margin: 0, fontSize: '17px', fontWeight: '600', color: '#1e293b', lineHeight: '1.5' }}>{config.perguntas[pergAtual]}</p></div>
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
        {!gravando && !temAudio && <button style={{ ...S.btn, marginTop: 0, background: '#7c3aed' }} onClick={iniciarGravacao}>🎙 Gravar resposta</button>}
        {gravando && <button style={{ ...S.btnSm, background: '#dc2626', color: 'white', flex: 1 }} onClick={pararGravacao}>⏹ Parar gravação</button>}
        {temAudio && !gravando && (<>
          <button style={{ ...S.btnSm, background: '#f1f5f9', color: '#475569' }} onClick={regravar}>🔄 Regravar</button>
          <button style={{ ...S.btn, marginTop: 0, flex: 1 }} onClick={avancar}>{pergAtual + 1 < config.perguntas.length ? 'Próxima →' : 'Enviar ✓'}</button>
        </>)}
      </div>
    </div><style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.3 } }`}</style></div>
  )
}

function Painel({ onVoltar }) {
  const [senha, setSenha] = useState("")
  const [auth, setAuth] = useState(false)
  const [candidatos, setCandidatos] = useState([])
  const [exp, setExp] = useState(null)
  const [audiosCarregados, setAudiosCarregados] = useState({})
  const [carregandoAudio, setCarregandoAudio] = useState(null)
  const [filtroVaga, setFiltroVaga] = useState("todos")
  const [filtroStatus, setFiltroStatus] = useState("todos")
  const [carregando, setCarregando] = useState(false)

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
      const a = {}; snap.docs.forEach(d => { const dt = d.data(); a[dt.pergunta] = dt.audioBase64 })
      setAudiosCarregados(prev => ({ ...prev, [c.id]: a }))
    } catch { setAudiosCarregados(prev => ({ ...prev, [c.id]: {} })) }
    setCarregandoAudio(null)
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
    out: { background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' },
    inp: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', outline: 'none', marginBottom: '16px' },
    vb: (v) => ({ display: 'inline-block', background: v === 'cs-senior' ? '#ede9fe' : '#e0f2fe', color: v === 'cs-senior' ? '#7c3aed' : '#0369a1', borderRadius: '99px', padding: '2px 10px', fontSize: '11px', fontWeight: '600' })
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

  let lista = candidatos
  if (filtroVaga !== "todos") lista = lista.filter(x => x.vaga === filtroVaga)
  if (filtroStatus !== "todos") lista = lista.filter(x => x.avaliacao?.classificacao?.includes(filtroStatus === "avanca" ? "Avança" : filtroStatus === "talvez" ? "Talvez" : "Não avança"))

  return (
    <div style={sP.page}>
      <div style={{ maxWidth: '900px', margin: '0 auto 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a' }}>Painel G&C — Entrevistas por Áudio</h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>{candidatos.length} candidato(s)</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={sP.btn} onClick={carregarCandidatos} disabled={carregando}>{carregando ? "Carregando..." : "🔄 Atualizar"}</button>
          <button style={sP.out} onClick={onVoltar}>← Voltar</button>
        </div>
      </div>
      <div style={{ maxWidth: '900px', margin: '0 auto 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', color: '#64748b', alignSelf: 'center', marginRight: '4px' }}>Vaga:</span>
        {[["todos", "Todas"], ["cs-senior", "CS Sênior"], ["cs-b2b", "CS B2B"]].map(([v, l]) => (
          <button key={v} onClick={() => setFiltroVaga(v)} style={{ ...sP.btn, background: filtroVaga === v ? '#7c3aed' : 'white', color: filtroVaga === v ? 'white' : '#475569', border: '1px solid #e2e8f0', padding: '6px 14px', fontSize: '13px' }}>{l}</button>
        ))}
      </div>
      <div style={{ maxWidth: '900px', margin: '0 auto 24px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', color: '#64748b', alignSelf: 'center', marginRight: '4px' }}>Status:</span>
        {[["todos", "Todos"], ["avanca", "✅ Avança"], ["talvez", "🟡 Talvez"], ["nao", "❌ Não avança"]].map(([v, l]) => (
          <button key={v} onClick={() => setFiltroStatus(v)} style={{ ...sP.btn, background: filtroStatus === v ? '#7c3aed' : 'white', color: filtroStatus === v ? 'white' : '#475569', border: '1px solid #e2e8f0', padding: '6px 14px', fontSize: '13px' }}>{l}</button>
        ))}
      </div>
      {lista.length === 0 && <div style={{ ...sP.card, textAlign: 'center', color: '#64748b', padding: '40px' }}>Nenhum candidato ainda.</div>}
      {lista.map((x, i) => {
        const vc = VAGAS[x.vaga] || VAGAS['cs-senior']
        const aud = audiosCarregados[x.id] || {}
        return (
          <div key={x.id} style={sP.card} onClick={() => expandir(i, x)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '16px' }}>{x.nome}</strong>
                <span style={sP.vb(x.vaga)}>{x.vaga === 'cs-b2b' ? 'CS B2B' : 'CS Sênior'}</span>
                <span style={{ color: '#94a3b8', fontSize: '13px' }}>{x.data}</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={S.sc(x.avaliacao?.score || 0)}>{x.avaliacao?.score || '?'}/100</span>
                <span style={{ fontSize: '18px' }}>{x.avaliacao?.classificacao?.split(' ')[0]}</span>
                <button onClick={(e) => deletar(x, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#dc2626', padding: '4px' }} title="Apagar">🗑</button>
              </div>
            </div>
            {exp === i && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                <p style={{ color: '#475569', fontSize: '14px', marginBottom: '16px' }}>{x.avaliacao?.resumo}</p>
                {x.avaliacao?.pontos_fortes?.length > 0 && (
                  <div style={{ marginBottom: '12px' }}><strong style={{ fontSize: '13px', color: '#16a34a' }}>✅ Pontos fortes</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>{x.avaliacao.pontos_fortes.map((p, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{p}</li>)}</ul>
                  </div>
                )}
                {x.avaliacao?.alertas?.length > 0 && (
                  <div style={{ marginBottom: '16px' }}><strong style={{ fontSize: '13px', color: '#dc2626' }}>⚠️ Alertas</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>{x.avaliacao.alertas.map((a, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{a}</li>)}</ul>
                  </div>
                )}
                <strong style={{ fontSize: '13px', color: '#475569' }}>Respostas</strong>
                {carregandoAudio === x.id && <p style={{ fontSize: '13px', color: '#7c3aed', marginTop: '8px' }}>Carregando áudios...</p>}
                {x.respostas?.map((r, j) => (
                  <div key={j} style={{ marginTop: '12px', background: '#f8fafc', borderRadius: '8px', padding: '16px' }}>
                    <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>P{j + 1}: {vc.perguntas[j] || 'Pergunta não disponível'}</p>
                    {aud[j] && <div style={{ marginBottom: '8px' }}><audio controls src={aud[j]} style={{ width: '100%', height: '36px' }} /></div>}
                    {r.duracao != null && <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#7c3aed' }}>⏱ Duração: {formatarTempo(r.duracao)}</p>}
                    {r.transcricao && (<details><summary style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer' }}>Ver transcrição</summary><p style={{ margin: '6px 0 0', fontSize: '13px', color: '#1e293b', lineHeight: '1.5' }}>{r.transcricao}</p></details>)}
                    {r.texto && !r.transcricao && <p style={{ margin: 0, fontSize: '13px', color: '#1e293b', lineHeight: '1.5' }}>{r.texto}</p>}
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

export default function App() {
  const [tela, setTela] = useState("candidato")
  const [vagaId, setVagaId] = useState(null)
  const apiKey = import.meta.env.VITE_ANTHROPIC_KEY || ""

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const v = p.get('vaga')
    if (v && VAGAS[v]) setVagaId(v)
  }, [])

  if (tela === "painel") return <Painel onVoltar={() => setTela("candidato")} />

  if (!vagaId) return (
    <div style={S.page}><div style={S.box}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>👋</div>
        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' }}>Curseduca — Processo Seletivo</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Selecione a vaga para continuar</p>
      </div>
      {Object.entries(VAGAS).map(([id, cfg]) => (
        <button key={id} onClick={() => setVagaId(id)} style={{ ...S.btn, background: 'white', color: '#1e293b', border: '2px solid #e2e8f0', textAlign: 'left', padding: '20px', borderRadius: '12px', marginBottom: '12px' }}>
          <strong style={{ display: 'block', fontSize: '16px', marginBottom: '4px' }}>{cfg.titulo}</strong>
          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '400' }}>{cfg.subtitulo}</span>
        </button>
      ))}
      <button onClick={() => setTela("painel")} style={{ ...S.btn, background: '#1e293b', marginTop: '24px' }}>🔒 Painel G&C</button>
    </div></div>
  )

  return (
    <div style={{ position: "relative" }}>
      <TelaCandidato apiKey={apiKey} vagaId={vagaId} onFinalizar={() => {}} />
      <button onClick={() => setTela("painel")} style={{ position: "fixed", bottom: "16px", right: "16px", background: "#1e293b", color: "white", border: "none", borderRadius: "8px", padding: "10px 18px", fontSize: "13px", fontWeight: "600", cursor: "pointer", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,.3)" }}>🔒 Painel G&C</button>
    </div>
  )
}
