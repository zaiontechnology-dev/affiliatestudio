# TROUBLESHOOTING

| Sintoma | Causa provável | Solução |
|---|---|---|
| SmartScreen bloqueia o instalador | Sem assinatura de código | *Mais informações → Executar assim mesmo* após conferir o SHA-256 |
| “Criptografia do sistema indisponível” | safeStorage/DPAPI indisponível (perfil do Windows corrompido ou ambiente sem chaveiro) | Reinicie a sessão do Windows; credenciais não são salvas em texto puro |
| Conta em “Credencial expirada” | Secret alterado, acesso revogado, backup de outro PC | *Configurar* e informe as credenciais novamente |
| “Limite de API atingido” | Muitas requisições | Aguarde; aumente o intervalo das campanhas |
| Shopee recusa assinatura (10020) | Relógio do Windows dessincronizado ou Secret incorreto | Sincronize data/hora (*Configurações → Hora → Sincronizar agora*) |
| Campanha ativa mas nada publicado | Fora da janela, sem destino autorizado, nenhum produto atende aos filtros/score, sem link de afiliado, revalidação suspensa | Veja *Central de atividades* (motivo registrado) e use *Pré-visualizar ofertas elegíveis* |
| Telegram “bot is not a member” / “not enough rights” | Bot fora do grupo ou sem permissão de publicar no canal | Adicione o bot como administrador e clique *Verificar permissões* |
| Item em “Status de envio desconhecido” | Conexão caiu após o envio | Verifique no canal e confirme ou cancele |
| Publicações “Expiradas” | PC desligado/suspenso no horário | Comportamento intencional; ajuste a tolerância em *Configurações* |
| App não abre / erro ao iniciar | Banco corrompido | Restaure um backup: renomeie `zaion-affiliate-studio.db` e copie um arquivo de `backups\` com esse nome |
| IA “resultado descartado” | Saída alterou link, omitiu identificação ou inventou números | Esperado (proteção); use o template |
| Ollama não detectado | Serviço parado | Abra o Ollama; endereço padrão `http://127.0.0.1:11434` |

Logs: *Sistema → Logs* (segredos já removidos).
