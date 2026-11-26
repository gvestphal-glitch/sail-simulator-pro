# Santos Sail Simulator Mobile

Protótipo nativo em Godot 4.6, com renderizador Mobile e projeto único para iOS e Android.

Abra `project.godot` no Godot 4.6.3 e execute a cena principal. A cena de treino explora o ILCA e uma representação esquemática da Ponta da Praia. O vento é fixo neste protótipo. As regras completas de regata, os adversários, a meteorologia ao vivo, o Snipe e o Optimist ainda pertencem ao protótipo anterior.

| Comando | Toque | Teclado para testes |
| --- | --- | --- |
| Leme | Arraste no controle à direita | Setas esquerda e direita |
| Vela grande | Suba para caçar e desça para folgar | Setas para cima e para baixo |
| Escora | Mantenha pressionado | Espaço |
| Bombar | Mantenha pressionado e solte para folgar | B |

O shader da água e a simulação usam os mesmos parâmetros de onda. As alturas na proa, na popa e nas laterais orientam o casco. A esteira registra a trajetória da popa e se espalha antes de desaparecer. O ajuste final dos parâmetros de vela, dos materiais e do orçamento de GPU depende de testes em aparelhos.

## Exportação

- Android requer os templates do Godot, configuração do SDK/JDK e um perfil de exportação com identificador do aplicativo. Para distribuir, configure também a assinatura.
- iOS requer os templates do Godot, macOS com Xcode e configuração de assinatura para o dispositivo ou distribuição.

Este pacote contém o projeto-fonte. Validação local com Godot headless cobre a simulação e as entradas. A compilação do shader na GPU, a exportação assinada e o desempenho nos dispositivos precisam de validação no hardware correspondente.
