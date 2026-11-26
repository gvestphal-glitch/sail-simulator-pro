# ADR-0001 — Uma feature por vez

Estado: aceito pelo responsável pelo projeto.

Contexto: duas pessoas passarão a colaborar no mesmo simulador. As mudanças precisam ser rastreáveis e revisáveis.

Decisão: toda implementação começa com uma issue. Antes do código, registrar em docs/adr/NNNN-titulo.md a issue, contexto, alternativas, decisão, consequências e critérios de validação. Registrar o aceite do responsável na issue. Trabalhar em uma branch própria e abrir um PR por feature, com o ADR, código, testes e Closes #N. Aguardar revisão antes de integrar na main. Manter apenas um PR de feature em andamento no projeto.

Consequência: o backlog pode ter várias issues abertas. O desenvolvimento das features é sequencial. Publicar o jogo é uma etapa separada da integração.
