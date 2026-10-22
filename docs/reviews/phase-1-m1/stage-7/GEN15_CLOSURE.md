# Stage 7 — GO técnico e operacional, gen15

**Decisão:** GO para Phase 1 M1 Stage 7, exclusivamente **CT200 DEVELOPMENT**.
**Responsável:** Alex. **Revisão independente:** `deleg_967e7b0e`, não autor, modelo `gpt-6-luna`.

## Resultado verificado

| Gate | Evidência real |
| --- | --- |
| CI canónica | Uma invocação, **42/42 PASS**; sem repetir CI consumida |
| Testes | **212 unitários** e **38 PostgreSQL** PASS |
| Artefacto | O mesmo digest qualificado foi verificado e promovido no CT200; sem instalar dependências nem compilar no alvo |
| Backup/restauro | Dump restaurado em DB descartável, paridade de catálogo/ledger/ACL; probe removido; backup retido com modo `0600` |
| Migração | `0013_stage7_runtime_acceptance_cleanup`, ledger 12→13, seguida de execução no-op |
| Runtime | Release gen15 ativa; Admin API, Portal API e worker ativos; saúde e rejeição de Host verificadas independentemente nas APIs e no Caddy existente |
| Aceitação autenticada | **25 probes PASS**, Staff MFA e Portal reais, snapshots v1/v2, revogação→401, logout e limpeza |
| Limpeza SQL independente | 1 run `CLEANED`, 2 Trips `CANCELLED`, 1 Portal Principal retirado; zero grants/pointers/sessões ativos das fixtures |
| Retenção | 2 snapshots e 7 eventos de auditoria da fixture preservados; fingerprints dos Trips/snapshots históricos não registados inalterados |
| Limpeza operacional | One-shot inativo/status 0, credenciais efémeras ausentes, transportes e DB de restauro ausentes |
| Evidência | **42 artefactos** indexados, cobertura exata do diretório; **163/163** entradas do freeze verificadas, sem divergências |
| Scan final | **164 ficheiros**, incluindo validação e freeze, PASS e zero findings |
| Revisão independente | **GO**, zero findings BLOCKER/HIGH/MEDIUM/LOW; o mesmo freeze e índice foram recomputados pelo revisor |

## Identidade imutável

- Commit do código/artefacto: `5609bcb44edb9baa2d10ff43e7e69c356de6ca35`.
- Artefacto: `88e5817721c60395700e36ab2ea30adde1a15d60878e485b6c9d888ae7243273`.
- CI receipt: `acfc09323c591a6fed16be5b1f807b730918e9e36e30776877c04dae764f987e`.
- Freeze: `c2ab7e26a077d8647731c5520b3336bad67fe5cbaef9e70c48ffb979dace3ec5`.
- Aggregate do freeze: `74011d6d2cbbeed409048e4ad7079fd6deb5931d657ab8f9f5c9b4cd4078a19d`.
- Índice: `af11fbf1314392ae7dbed9be6c4e5ea7cfc558c143d8ffd7dafb61c1390c1e10`.
- Invocação autenticada CT200: `5fd5770d56424e8cb51b322129afdc05`.
- Release instalada: `/opt/travelos/releases/travelos-stage7-gen15-5609bcb4`.

## Fontes e reprodução

- [Freeze](../../../evidence/phase-1-m1/stage-7/gen15/candidate-freeze.json), [índice](../../../evidence/phase-1-m1/stage-7/gen15/execution/EVIDENCE_INDEX.json) e [scan final](../../../evidence/phase-1-m1/stage-7/gen15/final-candidate-scan.json).
- [Revisão independente](GEN15_INDEPENDENT_REVIEW.json) e [adjudicação](GEN15_ADJUDICATION.json).
- Os outputs de execução, scripts operacionais efetivamente utilizados e proveniência estão no diretório `execution` do pacote. O `final-source-scope.json` preserva stdout bruto do pnpm, incluindo banner antes do JSON; não é uma resposta HTTP nem um JSON normalizado.
- Verificação somente de leitura, a partir da raiz do sucessor: `python3 docs/evidence/phase-1-m1/stage-7/gen15/execution/evidence-producer.py verify`.
- As gerações históricas, incluindo a falha de cleanup gen13 e a CI FAIL gen14, continuam preservadas. Não foram reclassificadas como PASS.

## Decisões e limites

As três exclusões do revisor foram adjudicadas explicitamente: este GO não constitui prontidão de produção nem aprovação legal de retenção; não entrega Stage 8 ou capacidades Portal mais amplas; não afirma imutabilidade global do host. Os custos de interpretação incorreta constam da adjudicação. Não existem minors adiados.

A topologia Caddy foi descoberta e a verificação local corrigida, sem alterar Caddy, listeners ou firewall. O helper de backup produziu inicialmente modo `664`; apenas o novo backup foi restringido a `600` e o digest reconfirmado antes do staging. Ambos os receipts permanecem disponíveis, sem alegação sobre leituras não observadas nesse intervalo.

**Política do selo Git:** manter a branch `stage7/runtime-acceptance-cleanup-successor` e o worktree; commit documental separado do commit do artefacto; tag local anotada `travelos-phase-1-m1-stage-7-gen15-go` no commit que contém este registo. Nenhum merge, push, novo acesso/credencial, exposição pública ou edição direta das tabelas de autenticação.

**Stage 7 actions = 1. Stage 8 actions = 0.** O próximo stage não foi iniciado.
