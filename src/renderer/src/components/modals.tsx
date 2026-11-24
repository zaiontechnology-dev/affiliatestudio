import { useEffect, useState } from 'react'
import type { Destination, MessageTemplate, Product } from '@shared/types'
import { Button, Chips, Field, Input, Modal, Notice, Select, Toggle, useAction } from './ui'
import { MessagePreview } from './domain'
import { call, useQuery } from '../lib/api'
import { CHANNEL_NAMES, parseMoneyToCents } from '../lib/format'

/** Adiciona produto à fila (modo manual) com pré-visualização real. */
export function PublishModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { data: dests } = useQuery<Destination[]>('destinations.list')
  const { data: templates } = useQuery<MessageTemplate[]>('templates.list')
  const [selected, setSelected] = useState<Array<string | number>>([])
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [approval, setApproval] = useState(false)
  const [preview, setPreview] = useState<{ text: string; hasLink: boolean } | null>(null)
  const { run, busy } = useAction()

  useEffect(() => {
    if (templates?.length && templateId === null) setTemplateId(templates[0]!.id)
  }, [templates, templateId])
  useEffect(() => {
    if (!product || templateId === null) return
    call<{ text: string; hasLink: boolean }>('copy.preview', { templateId, productId: product.id }).then(setPreview).catch(() => setPreview(null))
  }, [product, templateId])

  if (!product) return null
  const usable = (dests ?? []).filter((d) => d.consentConfirmed && d.status !== 'error')
  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title="Criar publicação"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!selected.length}
            loading={busy === 'q'}
            onClick={() =>
              run('q', async () => {
                await call('queue.enqueueManual', { productId: product.id, destinationIds: selected, templateId, requireApproval: approval })
                onClose()
              }, approval ? 'Publicação aguardando sua aprovação na fila.' : 'Publicação agendada no próximo horário permitido de cada destino.')
            }
          >
            Adicionar à fila
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="text-sm font-medium">{product.title}</div>
          <Field label="Destinos autorizados">
            {usable.length ? (
              <Chips options={usable.map((d) => ({ value: d.id, label: `${d.name} · ${CHANNEL_NAMES[d.channelId]}` }))} value={selected} onChange={setSelected} />
            ) : (
              <Notice tone="warn">Cadastre um destino e confirme a autorização em Grupos e canais.</Notice>
            )}
          </Field>
          <Field label="Modelo de mensagem">
            <Select value={templateId ?? ''} onChange={(e) => setTemplateId(Number(e.target.value))} options={(templates ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          </Field>
          <Toggle checked={approval} onChange={setApproval} label="Exigir minha aprovação antes do envio" />
          {preview && !preview.hasLink && (
            <Notice tone="warn" title="Sem link de afiliado">
              Gere o link pela API oficial (botão de link no card) ou cadastre um link manual. Sem link válido a publicação não é criada.
            </Notice>
          )}
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Pré-visualização</div>
          <MessagePreview text={preview?.text ?? ''} imageUrl={product.imageUrl} channel="whatsapp" />
        </div>
      </div>
    </Modal>
  )
}

/** Gera link de afiliado pela API oficial ou registra link manual. */
export function LinkModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [manual, setManual] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const { run, busy } = useAction()
  const [canGenerate, setCanGenerate] = useState<boolean | null>(null)
  useEffect(() => {
    setResult(null)
    setManual('')
    if (product) call<{ canGenerate: boolean }>('links.detect', product.url).then((r) => setCanGenerate(r.canGenerate)).catch(() => setCanGenerate(false))
  }, [product])
  if (!product) return null
  return (
    <Modal open onClose={onClose} title="Link de afiliado">
      <div className="space-y-4">
        <div className="text-sm">{product.title}</div>
        {canGenerate ? (
          <Button
            variant="primary"
            loading={busy === 'g'}
            onClick={() =>
              run('g', async () => {
                const r = await call<{ url: string }>('links.generate', { url: product.url, subIds: ['zaion', 'catalogo'], productId: product.id })
                setResult(r.url)
              }, 'Link gerado pela API oficial.')
            }
          >
            Gerar pela API oficial
          </Button>
        ) : (
          <Notice tone="info">Geração automática indisponível para este marketplace/conta. Gere o link no portal oficial do programa e cole abaixo.</Notice>
        )}
        {result && (
          <div className="flex gap-2">
            <Input readOnly value={result} />
            <Button onClick={() => run('c', () => call('links.copy', result), 'Link copiado.')}>Copiar</Button>
          </div>
        )}
        <Field label="Cadastrar link manual (gerado no portal do programa)" hint="O link será marcado como “não verificado” pelo Zaion.">
          <div className="flex gap-2">
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="https://…" />
            <Button disabled={!manual} loading={busy === 'm'} onClick={() => run('m', () => call('links.saveManual', { url: product.url, affiliateUrl: manual, productId: product.id }), 'Link manual salvo.')}>
              Salvar
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  )
}

export function ManualProductModal({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: readonly string[] }) {
  const [f, setF] = useState({ title: '', url: '', affiliateUrl: '', price: '', original: '', commission: '', category: '', imageUrl: '', coupon: '' })
  const { run, busy } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cadastrar produto manualmente"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={busy === 's'}
            disabled={!f.title || !f.url}
            onClick={() =>
              run('s', async () => {
                const commission = f.commission ? Number(f.commission.replace(',', '.')) / 100 : null
                await call('products.addManual', {
                  title: f.title,
                  url: f.url,
                  affiliateUrl: f.affiliateUrl,
                  priceCents: parseMoneyToCents(f.price),
                  originalPriceCents: parseMoneyToCents(f.original),
                  commissionRate: commission,
                  category: f.category || null,
                  imageUrl: f.imageUrl,
                  coupon: f.coupon || undefined
                })
                onClose()
              }, 'Produto cadastrado.')
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Título *" className="col-span-2"><Input value={f.title} onChange={set('title')} /></Field>
        <Field label="URL do produto *" className="col-span-2"><Input value={f.url} onChange={set('url')} placeholder="https://" /></Field>
        <Field label="Link de afiliado (do portal oficial)" className="col-span-2"><Input value={f.affiliateUrl} onChange={set('affiliateUrl')} placeholder="https://" /></Field>
        <Field label="Preço atual (R$)"><Input value={f.price} onChange={set('price')} placeholder="49,90" /></Field>
        <Field label="Preço anterior verificável (R$)" hint="Deixe vazio se não houver fonte"><Input value={f.original} onChange={set('original')} /></Field>
        <Field label="Comissão (%)"><Input value={f.commission} onChange={set('commission')} placeholder="7" /></Field>
        <Field label="Categoria"><Select value={f.category} onChange={set('category')} options={[{ value: '', label: '—' }, ...categories.map((c) => ({ value: c, label: c }))]} /></Field>
        <Field label="URL da imagem autorizada" className="col-span-2"><Input value={f.imageUrl} onChange={set('imageUrl')} placeholder="https://" /></Field>
        <Field label="Cupom real (opcional)" className="col-span-2"><Input value={f.coupon} onChange={set('coupon')} /></Field>
      </div>
    </Modal>
  )
}
