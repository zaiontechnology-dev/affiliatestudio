import { useEffect, useState } from 'react'
import { Database, Download, FolderOpen, HardDrive, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import type { AppSettings, LogEntry } from '@shared/types'
import { Badge, Button, Card, Field, Input, Loading, Notice, Page, Select, Table, Td, Toggle, useAction, useFeedback, ZaionMark } from '../components/ui'
import { call, useQuery } from '../lib/api'
import { dt } from '../lib/format'

export function SettingsPage({ onTheme }: { onTheme: (t: AppSettings['theme']) => void }) {
  const { data, reload } = useQuery<AppSettings>('settings.get')
  const [s, setS] = useState<AppSettings | null>(null)
  const { run, busy } = useAction()
  useEffect(() => {
    if (data) setS(data)
  }, [data])
  if (!s) return <Loading />
  const save = () =>
    run('s', async () => {
      const { scoreWeights: _w, autopilotEnabled: _a, ...rest } = s
      void _w
      void _a
      await call('settings.update', rest)
      onTheme(s.theme)
      await reload()
    }, 'Configurações salvas.')
  return (
    <Page title="Configurações" actions={<Button variant="primary" loading={busy === 's'} onClick={save}>Salvar</Button>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Aparência e região">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tema"><Select value={s.theme} onChange={(e) => setS({ ...s, theme: e.target.value as AppSettings['theme'] })} options={[{ value: 'dark', label: 'Escuro' }, { value: 'light', label: 'Claro' }, { value: 'system', label: 'Seguir o Windows' }]} /></Field>
            <Field label="Fuso horário"><Select value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} options={['America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Cuiaba', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'].map((t) => ({ value: t, label: t }))} /></Field>
          </div>
        </Card>
        <Card title="Segundo plano e Windows">
          <div className="space-y-3">
            <Field label="Ao fechar a janela"><Select value={s.closeBehavior} onChange={(e) => setS({ ...s, closeBehavior: e.target.value as AppSettings['closeBehavior'] })} options={[{ value: 'ask', label: 'Perguntar' }, { value: 'tray', label: 'Minimizar para a bandeja' }, { value: 'quit', label: 'Encerrar completamente' }]} /></Field>
            <Toggle checked={s.autoLaunch} onChange={(v) => setS({ ...s, autoLaunch: v })} label="Iniciar com o Windows (minimizado na bandeja)" />
            <Toggle checked={s.preventSleepWhileActive} onChange={(v) => setS({ ...s, preventSleepWhileActive: v })} label="Impedir suspensão enquanto houver campanhas ativas" />
            <Toggle checked={s.notificationsEnabled} onChange={(v) => setS({ ...s, notificationsEnabled: v })} label="Notificações do Windows" />
            <p className="text-xs text-muted">A prevenção de suspensão vale apenas enquanto o Zaion está aberto; o plano de energia do Windows não é alterado. Com o computador desligado, suspenso ou sem internet, nada é publicado.</p>
          </div>
        </Card>
        <Card title="Publicações">
          <div className="space-y-3">
            <Field label="Identificação publicitária (obrigatória em toda mensagem)"><Input value={s.disclosureText} onChange={(e) => setS({ ...s, disclosureText: e.target.value })} /></Field>
            <Field label="Tolerância para publicações atrasadas (min)" hint="Após religar o computador, itens mais atrasados que isso expiram em vez de serem disparados em lote."><Input type="number" min={5} value={s.missedPublicationGraceMinutes} onChange={(e) => setS({ ...s, missedPublicationGraceMinutes: Number(e.target.value) })} /></Field>
          </div>
        </Card>
        <Card title="Backups automáticos">
          <div className="space-y-3">
            <Toggle checked={s.backupDailyEnabled} onChange={(v) => setS({ ...s, backupDailyEnabled: v })} label="Backup diário" />
            <Toggle checked={s.backupWeeklyEnabled} onChange={(v) => setS({ ...s, backupWeeklyEnabled: v })} label="Backup semanal" />
            <Field label="Manter quantos backups de cada tipo"><Input type="number" min={1} value={s.backupRetention} onChange={(e) => setS({ ...s, backupRetention: Number(e.target.value) })} /></Field>
          </div>
        </Card>
      </div>
    </Page>
  )
}

interface AiStatus {
  provider: string
  ollama: { online: boolean; models: string[]; error?: string }
  hasOpenAIKey: boolean
  hasAnthropicKey: boolean
  hardware: { ramGb: number; freeRamGb: number; cpus: number; cpuModel: string; gpu: string | null; suggestion: string }
}

export function AiPage() {
  const { data: st, reload } = useQuery<AiStatus>('ai.status')
  const { data: settings, reload: rs } = useQuery<AppSettings>('settings.get')
  const [ai, setAi] = useState<AppSettings['ai'] | null>(null)
  const [key, setKey] = useState('')
  const { run, busy } = useAction()
  useEffect(() => {
    if (settings) setAi(settings.ai)
  }, [settings])
  if (!st || !ai) return <Loading />
  const keyProvider = ai.provider === 'openai' || ai.provider === 'anthropic' ? ai.provider : null
  return (
    <Page title="Inteligência artificial" subtitle="Opcional. Sem IA, o Zaion funciona integralmente com regras determinísticas e templates. Nenhum serviço pago é contratado automaticamente.">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Provedor" actions={<Button size="sm" variant="primary" loading={busy === 's'} onClick={() => run('s', async () => { await call('settings.update', { ai }); await rs(); await reload() }, 'Configuração de IA salva.')}>Salvar</Button>}>
          <div className="space-y-3">
            <Field label="Provedor"><Select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value as AppSettings['ai']['provider'], model: e.target.value === 'anthropic' ? 'claude-opus-5-5' : '' })} options={[{ value: 'none', label: 'Nenhum (templates)' }, { value: 'ollama', label: 'Ollama (local, gratuito)' }, { value: 'openai', label: 'OpenAI (sua chave)' }, { value: 'anthropic', label: 'Anthropic Claude (sua chave)' }]} /></Field>
            {ai.provider !== 'none' && <Field label="Modelo" hint={ai.provider === 'ollama' ? 'Nome do modelo instalado no Ollama' : 'Identificador do modelo do provedor'}><Input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} /></Field>}
            {ai.provider === 'ollama' && <Field label="Endereço do Ollama (somente local)"><Input value={ai.ollamaUrl} onChange={(e) => setAi({ ...ai, ollamaUrl: e.target.value })} /></Field>}
            {keyProvider && (
              <Field label={`Chave de API (${keyProvider === 'openai' ? 'OpenAI' : 'Anthropic'})`} hint={(keyProvider === 'openai' ? st.hasOpenAIKey : st.hasAnthropicKey) ? 'Chave salva com criptografia do Windows. Digite para substituir ou deixe vazio e salve para remover.' : 'Uso cobrado pelo provedor na sua conta.'}>
                <div className="flex gap-2">
                  <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
                  <Button onClick={() => run('k', async () => { await call('ai.setKey', { provider: keyProvider, apiKey: key }); setKey(''); await reload() }, key ? 'Chave salva.' : 'Chave removida.')}>Salvar chave</Button>
                </div>
              </Field>
            )}
          </div>
        </Card>
        <Card title="Diagnóstico do computador" subtitle="Para escolher um modelo local adequado. Nada é instalado sem sua autorização.">
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted">Memória RAM</dt><dd className="text-right">{st.hardware.ramGb} GB ({st.hardware.freeRamGb} GB livres)</dd>
            <dt className="text-muted">Processador</dt><dd className="truncate text-right" title={st.hardware.cpuModel}>{st.hardware.cpus} núcleos</dd>
            <dt className="text-muted">GPU</dt><dd className="text-right">{st.hardware.gpu ?? 'não identificada'}</dd>
            <dt className="text-muted">Ollama</dt><dd className="text-right">{st.ollama.online ? <Badge tone="ok">Online</Badge> : <Badge>Não detectado</Badge>}</dd>
          </dl>
          <Notice tone="info" title="Sugestão">{st.hardware.suggestion}</Notice>
          {st.ollama.online && <div className="mt-3 text-xs text-muted">Modelos instalados: {st.ollama.models.join(', ') || 'nenhum'}</div>}
          {!st.ollama.online && <p className="mt-3 text-xs text-muted">Para usar IA local gratuita, instale o Ollama (ollama.com) e baixe um modelo com <code>ollama pull nome-do-modelo</code>. Modelos podem ocupar vários GB.</p>}
        </Card>
      </div>
    </Page>
  )
}

export function LogsPage() {
  const [level, setLevel] = useState('')
  const { data, reload } = useQuery<LogEntry[]>('logs.list', { level: level || undefined, limit: 500 }, { live: true })
  return (
    <Page title="Logs" subtitle="Tokens e segredos são removidos automaticamente antes de qualquer registro." actions={<Button size="sm" onClick={() => void reload()}>Atualizar</Button>}>
      <div className="w-48"><Select value={level} onChange={(e) => setLevel(e.target.value)} options={[{ value: '', label: 'Todos os níveis' }, { value: 'info', label: 'Info' }, { value: 'warn', label: 'Alerta' }, { value: 'error', label: 'Erro' }]} /></div>
      <Card padded={false}>
        <Table head={['Data', 'Nível', 'Origem', 'Mensagem']} empty={!data?.length}>
          {data?.map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap text-xs text-muted">{dt(l.createdAt)}</Td>
              <Td><Badge tone={l.level === 'error' ? 'bad' : l.level === 'warn' ? 'warn' : 'neutral'}>{l.level}</Badge></Td>
              <Td className="text-xs">{l.scope}</Td>
              <Td className="text-[13px]">{l.message}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  )
}

type BackupInfo = { file: string; name: string; kind: string; sizeBytes: number; sha256: string; createdAt: string }

export function BackupPage() {
  const { data, reload } = useQuery<BackupInfo[]>('backup.list')
  const { run, busy } = useAction()
  const { confirm } = useFeedback()
  const restore = async (file?: string) => {
    if (!(await confirm({ title: 'Restaurar backup', message: 'O banco atual será substituído na próxima inicialização (um backup de segurança é criado antes). Credenciais podem exigir nova autenticação se o backup veio de outro computador/usuário. Continuar?', confirmLabel: 'Restaurar', danger: true }))) return
    await run('r', async () => {
      const r = file ? await call('backup.restore', { file, confirm: true }) : await call('backup.restoreFromFile')
      return r
    }, (r) => (r ? 'Restauração preparada. Reinicie o Zaion (Encerrar completamente e abrir novamente).' : null))
  }
  return (
    <Page title="Backup e restauração" subtitle="Backups consistentes do SQLite com verificação de integridade e checksum SHA-256. Credenciais permanecem criptografadas e nunca são exportadas em texto puro."
      actions={<Button variant="primary" icon={<Database className="h-4 w-4" />} loading={busy === 'c'} onClick={() => run('c', async () => { await call('backup.create'); void reload() }, 'Backup criado.')}>Criar backup agora</Button>}>
      <div className="grid gap-4 md:grid-cols-4">
        <Card title="Exportar banco"><Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => run('e', () => call<string | null>('backup.export'), (f) => (f ? `Salvo em ${f}` : null))}>Exportar .db</Button></Card>
        <Card title="Exportar configurações" subtitle="Campanhas, templates, destinos — sem credenciais"><Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => run('j', () => call<string | null>('backup.exportConfig'), (f) => (f ? `Salvo em ${f}` : null))}>Exportar .json</Button></Card>
        <Card title="Restaurar de arquivo"><Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => void restore()}>Selecionar .db</Button></Card>
        <Card title="Integridade"><Button size="sm" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => run('i', () => call<{ ok: boolean; details: string[] }>('backup.integrity'), (r) => (r.ok ? 'Banco íntegro.' : `Problemas: ${r.details.join('; ')}`))}>Verificar banco</Button></Card>
      </div>
      <Card title="Backups locais" actions={<Button size="sm" variant="ghost" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => run('o', () => call('system.openDataFolder'))}>Abrir pasta de dados</Button>} padded={false}>
        <Table head={['Data', 'Tipo', 'Arquivo', 'Tamanho', '']} empty={!data?.length}>
          {data?.map((b) => (
            <tr key={b.file}>
              <Td className="whitespace-nowrap text-xs">{dt(b.createdAt)}</Td>
              <Td><Badge>{{ manual: 'Manual', daily: 'Diário', weekly: 'Semanal', 'pre-restore': 'Pré-restauração' }[b.kind] ?? b.kind}</Badge></Td>
              <Td className="font-mono text-xs">{b.name}</Td>
              <Td className="tabular text-xs">{(b.sizeBytes / 1024).toFixed(0)} KB</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => run('v', () => call('backup.verify', b.file), 'Backup íntegro (SQLite + SHA-256).')}>Verificar</Button>
                  <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void restore(b.file)}>Restaurar</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  )
}

export function About() {
  const { data } = useQuery<{ name: string; edition: string; version: string; slogan: string; paths: Record<string, string>; secureStorage: boolean }>('app.info')
  if (!data) return <Loading />
  return (
    <Page title="Sobre o Zaion Affiliate Studio">
      <Card>
        <div className="flex items-center gap-5">
          <ZaionMark size={64} />
          <div>
            <div className="text-xl font-semibold">{data.name}</div>
            <div className="text-sm text-muted">{data.edition} · versão {data.version}</div>
            <div className="mt-1 text-sm text-brand">{data.slogan}</div>
          </div>
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Armazenamento local">
          <dl className="space-y-2 text-xs">
            {Object.entries(data.paths).map(([k, v]) => (<div key={k}><dt className="text-muted">{{ userData: 'Dados do aplicativo', db: 'Banco de dados', backups: 'Backups', logs: 'Logs', exports: 'Exportações' }[k] ?? k}</dt><dd className="break-all font-mono">{v}</dd></div>))}
          </dl>
        </Card>
        <Card title="Segurança">
          <ul className="space-y-2 text-sm text-muted">
            <li className="flex items-center gap-2"><HardDrive className="h-4 w-4" /> Criptografia do sistema: {data.secureStorage ? <Badge tone="ok">Disponível (DPAPI)</Badge> : <Badge tone="bad">Indisponível — credenciais não serão salvas</Badge>}</li>
            <li>• Sem telemetria. Nenhum dado é enviado a servidores da Zaion.</li>
            <li>• Comunicação apenas com as APIs oficiais que você conectar.</li>
            <li>• Interface isolada (context isolation + sandbox + CSP).</li>
          </ul>
        </Card>
      </div>
    </Page>
  )
}
