export const BRAND = {
  name: 'Zaion Affiliate Studio',
  edition: 'Desktop Edition',
  technicalName: 'zaion-affiliate-studio',
  appId: 'com.zaion.affiliatestudio',
  version: '1.0.0',
  slogan: 'Inteligência que transforma ofertas em resultados.',
  dbFile: 'zaion-affiliate-studio.db'
} as const

export const CATEGORIES = [
  'Casa e decoração',
  'Eletrônicos',
  'Informática',
  'Smartphones',
  'Moda feminina',
  'Moda masculina',
  'Beleza',
  'Saúde e bem-estar',
  'Fitness',
  'Infantil',
  'Pets',
  'Ferramentas',
  'Automotivo',
  'Eletrodomésticos',
  'Utilidades domésticas',
  'Jardinagem',
  'Esportes',
  'Achadinhos baratos'
] as const

export const INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 120, 180, 240] as const

export const REPEAT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Não repetir nas últimas 24 horas' },
  { value: 3, label: 'Não repetir nos últimos 3 dias' },
  { value: 7, label: 'Não repetir nos últimos 7 dias' },
  { value: 15, label: 'Não repetir nos últimos 15 dias' },
  { value: 30, label: 'Não repetir nos últimos 30 dias' },
  { value: -1, label: 'Nunca repetir' },
  { value: 0, label: 'Sem restrição de repetição' }
]
