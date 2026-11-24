# Manual de utilização — Zaion Affiliate Studio

## 1. Primeiros passos (15 minutos)
1. **Contas de afiliados** → Shopee → *Conectar*: App ID e Secret da Open API. (Sem API? Use *Catálogo → Importar CSV* ou *Cadastrar produto* com o link gerado no portal do programa.)
2. **Telegram** → token do bot (@BotFather) → *Conectar e validar*. Para WhatsApp, ative o **modo assistido**.
3. **Grupos e canais** → *Novo destino*: nome, identificador, horários, intervalo mínimo, limite diário e **confirmação de autorização**. Clique *Verificar permissões*.
4. **Campanhas** → *Nova campanha* (ou edite “Achadinhos Gerais (demonstração)”, criada como rascunho): marketplaces, filtros, horários, intervalo, destinos, modo.
5. Comece em **modo semiautomático**: o Zaion seleciona e você aprova na *Fila de publicações*.
6. Clique **Iniciar AutoPilot** (canto superior direito).

## 2. Modos de operação
- **Manual**: você escolhe o produto (botão *Publicar* nos cards) e aprova.
- **Semiautomático**: o sistema seleciona, valida e prepara; aguarda sua aprovação.
- **Automático**: seleciona, valida, gera link e publica dentro das regras da campanha.

## 3. Garimpo, catálogo e Offer Score
Busque por palavra-chave e ordenação; filtre por desconto, comissão, avaliação, preço e score. Cada card mostra a fonte dos dados
(“API oficial”, “CSV”, “Manual”) e o selo **dados parciais** quando a confiança é baixa. Ajuste os pesos em *Zaion Offer Score*.

## 4. Links de afiliado
*Gerador de links*: cole a URL, informe Sub IDs (campanha, grupo, canal…) e gere pelo mecanismo oficial. Links colados manualmente ficam “não verificados”.

## 5. Fila de publicações
Aprovar, editar mensagem/horário, reordenar, cancelar, reprocessar falhas, *Publicar agora* (com confirmação).
- **Aguardando publicação manual** (WhatsApp assistido): *Copiar* → colar no grupo → *Marcar como publicada*.
- **Status de envio desconhecido**: verifique no canal; se a mensagem chegou, clique *Foi enviada*; se não, cancele e recrie. O Zaion nunca reenvia sozinho.
- **Expirada**: o horário passou com o computador desligado — não é disparada em lote.

## 6. Smart Copy e templates
Variáveis: `{{produto}} {{marketplace}} {{preco_atual}} {{preco_anterior}} {{desconto}} {{cupom}} {{link_afiliado}} {{avaliacao}} {{frete}} {{categoria}} {{validade}} {{identificacao_publicitaria}}`.
Linhas com variáveis sem dados reais desaparecem. A identificação publicitária é sempre incluída (edite o texto em *Configurações*).

## 7. Price Radar
Favorite produtos para monitorar. O histórico usa só observações reais (atualização a cada 6 h quando há integração oficial, ou manual).

## 8. Desempenho
*Dashboard*, *Analytics* (por período, marketplace, campanha, destino, horário), *Relatórios* (CSV), *Comissões* (sincronização oficial), *Histórico*.
Cliques aparecem como **indisponível** — nenhuma integração atual fornece esse dado.

## 9. Segundo plano
Ao fechar a janela escolha *Minimizar para a bandeja* (o AutoPilot continua) ou *Encerrar*. Ative *Iniciar com o Windows* e,
se quiser, *Impedir suspensão enquanto houver campanhas ativas*. **Com o PC desligado, suspenso ou sem internet nada é publicado.**

## 10. Backup
Automático diário/semanal (retenção configurável) + manual. *Restaurar* prepara a troca e aplica ao reiniciar (cria backup de segurança antes).
Backups de outro computador exigem reconectar as contas (credenciais protegidas pelo Windows).
