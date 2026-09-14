# Relatório independente de fechamento — TravelOS Phase 0 post-PO

## 1) Verificação de hashes
- **Hash do freeze candidato** verificado primeiro:  
  `590e6dcdebcf325fe3a677e140b74b18f4fe06eb14adedeb686da4b48cf60040`
- **Contagem do manifest**: declaradas **37** linhas, verificadas **37**
- **Matches**: **37**
- **Faltantes**: **0**
- **Mismatches**: **0**

Também verifiquei que:
- `AGENTS.md` do root existe;
- `AGENTS.md` do root é **byte-a-byte igual** a `docs/reviews/AGENTS_CANDIDATE.md`;
- hash de ambos: `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340`

## 2) Ataque ao desenho de privacidade/exclusão/restauro
Concluí que o desenho pós-PO **não mantém** uma dependência ativa de erasure ledger/key provider e **não promete** apagamento imediato de backups antigos.

Pontos verificados:
- **Sem claim de apagamento imediato em backups**: os documentos dizem explicitamente que a exclusão ativa remove acesso no sistema ativo, mas **não** apaga de imediato cópias retidas em backups criptografados.
- **Sem caminho de reativação em serviço live**:
  - publicação deletada retorna estado tipado de payload apagado;
  - documento segue `DELETING -> confirmação do provider -> DELETED`;
  - leituras falham fechado durante todo o fluxo;
  - crash **retoma** a máquina de estados, não reautoriza o objeto.
- **Restore fail-closed**:
  - restore é isolado / network-closed;
  - a cobertura do intervalo pós-backup é estabelecida por evidência de deletion-request, audit e operações;
  - ausência no banco restaurado **não** prova ausência de deleção posterior;
  - cobertura incompleta mantém os payloads afetados indisponíveis ou exige re-redação/bulk-delete antes de abrir serviço.
- **Sem dependência ativa de ledger/chave**:
  - a própria documentação aceita que V1 **não exige** erasure ledger independente nem `ErasureKeyProvider`;
  - não há serviço oculto equivalente reintroduzido nos documentos canônicos.

Conclusão desse ataque: o que sobra é **risco residual de backup** tratado como **gate pré-produção**, não como defeito semântico em Phase 0.

## 3) Regressão dos achados anteriores

| Item | Status | Conclusão |
|---|---|---|
| TOS-AR-001 | **CLOSED** | Host usa allowlist FQDN exata; host desconhecido/rejeitado é tratado de forma uniforme; Host nunca escolhe Agency. |
| TOS-AR-002 | **CLOSED** | Documentos protegidos não usam URL/bearer direto; cada request revalida sessão, TripAccessGrant, DocumentGrant e epoch. |
| TOS-AR-003 | **CLOSED** | A operação persistente usa business key/operation ID; outcome ambíguo vira `UNKNOWN_OUTCOME` com reconciliação antes de retry. |
| TOS-AR-004 | **CLOSED** | O novo contrato semântico é consistente: exclusão ativa, backup residual honesto, restore em quarentena e gate legal/threat-model pré-produção. |
| TOS-AR-005 | **CLOSED** | O `AGENTS.md` raiz existe e é idêntico à cópia candidata; a lacuna histórica foi fechada. |
| TOS-INT-001 | **CLOSED** | Job runtime passa a ser propriedade da TravelOS, com lease, CAS, heartbeat e quarentena `UNKNOWN_OUTCOME`; Graphile ficou fora. |
| TOS-INT-002 | **CLOSED** | Better Auth não possui migração runtime própria; SQL gerado entra na única cadeia de migração da TravelOS. |
| PO-001 | **CLOSED** | `HALF_UP` ficou como default comercial V1 apenas; políticas especializadas são explícitas e versionadas; unknown fail-closed. |
| PO-002 | **CLOSED** | `PrivateFilesystemProvider` ficou corretamente atrás do port `StorageProvider`, com IDs opacos e sem dependência de path/FS na domain/app. |
| PO-003 | **CLOSED** | Crypto-erasure / key provider / ledger deixam de ser requisito V1 obrigatório; exclusão ativa + backups cifrados + restore reconciliado estão documentados de forma honesta. |
| PO-004 | **CLOSED** | RPO/RTO ficaram corretamente como metas de engenharia, não garantias contratuais. |

## 4) Novos achados
- **Nenhum novo BLOCKER**
- **Nenhum novo HIGH**
- **Nenhuma contradição semântica residual** que impeça o fechamento documental

## 5) Gates remanescentes M1 / pré-produção
Mesmo com o fechamento documental confirmado, permanecem gates de implementação/verificação:
1. testes de política de rounding financeira para PO-001;
2. testes de contrato/import boundary e provider para PO-002;
3. prova M1/pré-produção de restauração isolada com reconciliação de deleções e aceitação jurídica/threat-model do residual backup window para PO-003/TOS-AR-004;
4. testes negativos de host allowlist, reautorização de documentos protegidos, reconciliação de `UNKNOWN_OUTCOME`, lease/CAS do job executor e drift de migração do Better Auth;
5. prova de que o `AGENTS.md` raiz continua igual à cópia canônica.

Nenhuma decisão de Product Owner permanece em aberto.

CLOSURE CONFIRMED WITH MEDIUM/LOW IMPLEMENTATION GATES
