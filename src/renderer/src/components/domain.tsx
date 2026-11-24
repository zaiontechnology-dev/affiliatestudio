import { clsx } from 'clsx'
import { Ban, ExternalLink, Heart, Link2, ListPlus, Star, Store } from 'lucide-react'
import type { IntegrationStatus, OfferScoreResult, Product, QueueStatus } from '@shared/types'
import { INTEGRATION_STATUS_LABEL, QUEUE_STATUS_LABEL } from '@shared/types'
import { Badge, Button } from './ui'
import { formatBRL, formatPct, formatRate, MARKETPLACE_NAMES, relative } from '../lib/format'

const TIER_LABEL: Record<OfferScoreResult['tier'], string> = {
  exceptional: 'Excepcional',
  excellent: 'Excelente',
  good: 'Boa',
  moderate: 'Moderada',
  low: 'Baixa prioridade'
}

export function ScoreBadge({ score, compact }: { score?: OfferScoreResult; compact?: boolean }) {
  if (!score) return null
  const tone = score.score >= 80 ? 'brand' : score.score >= 70 ? 'ok' : score.score >= 60 ? 'warn' : 'neutral'
  return (
    <span className="inline-flex items-center gap-1.5" title={`Confiança dos dados: ${Math.round(score.confidence * 100)}%`}>
      <Badge tone={tone} className="tabular">
        {score.score.toFixed(0)}
        {!compact && <span className="opacity-70">· {TIER_LABEL[score.tier]}</span>}
      </Badge>
      {score.confidence < 0.6 && <Badge tone="warn">dados parciais</Badge>}
    </span>
  )
}

export function IntegrationBadge({ status }: { status: IntegrationStatus }) {
  const tone = status === 'connected' ? 'ok' : status === 'error' || status === 'expired' ? 'bad' : status === 'rate_limited' || status === 'awaiting_auth' || status === 'awaiting_approval' ? 'warn' : 'neutral'
  return <Badge tone={tone}>{INTEGRATION_STATUS_LABEL[status]}</Badge>
}

export function QueueBadge({ status }: { status: QueueStatus }) {
  const tone =
    status === 'sent' ? 'ok' : status === 'failed' ? 'bad' : status === 'unknown' || status === 'awaiting_approval' || status === 'pending' ? 'warn' : status === 'scheduled' ? 'info' : 'neutral'
  return <Badge tone={tone}>{status === 'pending' ? 'Aguardando publicação manual' : QUEUE_STATUS_LABEL[status]}</Badge>
}

export function DataSource({ source }: { source: Product['dataSource'] }) {
  const map = { api: ['API oficial', 'ok'], csv: ['Importado (CSV)', 'neutral'], manual: ['Manual', 'neutral'], fixture: ['Fixture de teste', 'warn'] } as const
  const [label, tone] = map[source]
  return <Badge tone={tone}>{label}</Badge>
}

export interface ProductActions {
  onFavorite?: (p: Product) => void
  onBlock?: (p: Product) => void
  onLink?: (p: Product) => void
  onQueue?: (p: Product) => void
  onOpen?: (p: Product) => void
}

export function ProductCard({ p, actions }: { p: Product; actions: ProductActions }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-line bg-card transition-colors hover:border-brand/40">
      <div className="relative aspect-[4/3] bg-surface">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">Sem imagem</div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          <Badge tone="neutral" className="bg-bg/80 backdrop-blur">
            {MARKETPLACE_NAMES[p.marketplaceId]}
          </Badge>
        </div>
        <div className="absolute right-2 top-2">
          <ScoreBadge score={p.score} compact />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <div className="line-clamp-2 min-h-[2.5rem] text-[13px] font-medium leading-snug" title={p.title}>
          {p.title}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="tabular text-lg font-semibold">{formatBRL(p.priceCents)}</span>
          {p.originalPriceCents && p.priceCents && p.originalPriceCents > p.priceCents && <span className="tabular text-xs text-muted line-through">{formatBRL(p.originalPriceCents)}</span>}
          {p.discountPct ? <Badge tone="brand">-{formatPct(p.discountPct)}</Badge> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>Comissão {formatRate(p.commissionRate)}</span>
          {p.rating ? (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-3 w-3" /> {p.rating.toFixed(1)}
            </span>
          ) : null}
          {p.salesCount !== null && <span>{p.salesCount.toLocaleString('pt-BR')} vendas</span>}
          {p.shopName && (
            <span className="inline-flex items-center gap-0.5 truncate">
              <Store className="h-3 w-3" /> {p.shopName}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted">Atualizado {relative(p.lastCheckedAt ?? p.updatedAt)}</div>
        <div className="mt-auto flex items-center gap-1 pt-3">
          {actions.onQueue && (
            <Button size="sm" variant="primary" icon={<ListPlus className="h-3.5 w-3.5" />} onClick={() => actions.onQueue!(p)} className="flex-1">
              Publicar
            </Button>
          )}
          {actions.onLink && (
            <Button size="sm" variant="ghost" onClick={() => actions.onLink!(p)} title="Gerar link de afiliado" aria-label="Gerar link">
              <Link2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {actions.onFavorite && (
            <Button size="sm" variant="ghost" onClick={() => actions.onFavorite!(p)} title={p.isFavorite ? 'Remover dos favoritos' : 'Favoritar e monitorar preço'} aria-label="Favoritar">
              <Heart className={clsx('h-3.5 w-3.5', p.isFavorite && 'fill-bad text-bad')} />
            </Button>
          )}
          {actions.onBlock && (
            <Button size="sm" variant="ghost" onClick={() => actions.onBlock!(p)} title={p.isBlocked ? 'Desbloquear' : 'Bloquear produto'} aria-label="Bloquear">
              <Ban className={clsx('h-3.5 w-3.5', p.isBlocked && 'text-bad')} />
            </Button>
          )}
          {actions.onOpen && (
            <Button size="sm" variant="ghost" onClick={() => actions.onOpen!(p)} title="Ver produto original" aria-label="Abrir original">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Pré-visualização estilo WhatsApp / Telegram (texto puro). */
export function MessagePreview({ text, imageUrl, channel }: { text: string; imageUrl?: string | null; channel: 'whatsapp' | 'telegram' }) {
  const wa = channel === 'whatsapp'
  return (
    <div className={clsx('rounded-xl p-4', wa ? 'bg-[#0b141a]' : 'bg-[#0e1621]')}>
      <div className={clsx('ml-auto max-w-[340px] overflow-hidden rounded-lg text-[13px] leading-[1.45] text-[#e9edef] shadow', wa ? 'bg-[#005c4b]' : 'bg-[#2b5278]')}>
        {imageUrl && <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="max-h-56 w-full object-cover" />}
        <div className="whitespace-pre-wrap break-words px-2.5 py-1.5">{text || <span className="opacity-60">Mensagem vazia</span>}</div>
        <div className="px-2.5 pb-1 text-right text-[10px] opacity-60">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </div>
  )
}
