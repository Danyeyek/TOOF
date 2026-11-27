# Бот TOOF — архитектура
## 1. Зависимости, которые должны существовать

- `js/rules.js`: `BOARD_SIZE=10`, `SECTOR_SIZE=5`, `SECTORS_TO_WIN=3`, `MAX_FIGURE=6`,
  `EMPTY=''`, `SIDE_X='X'`, `SIDE_O='O'`, `SHAPES`, `MIXED_SHAPES`, `ORIENTATIONS`,
  `buildOrientations(points)`.
- `js/game-core.js`: `key(r,c)`, `parseKey(k)`, `Game.board`, `Game.locked` (Set ключей),
  `Game.owners` (Map ключ → владелец), `Game.current`.

## 2. Шаблоны фигур — `TEMPLATES` (32 штуки)

`addTemplate(cells, owners, mixed)` хранит `cells`, `owners` ('me'/'other'),
`mixed`, а также границы якорей:
`minR = -min(dr)`, `maxR = 9 - max(dr)`, `minC = -min(dc)`, `maxC = 9 - max(dc)`.

- Линия: `buildOrientations([[0,0],[0,1],[0,2],[0,3]])` → горизонталь и вертикаль,
  плюс вручную две диагонали `[[0,0],[1,1],[2,2],[3,3]]` и `[[0,0],[1,-1],[2,-2],[3,-3]]`.
  `owners` везде `'me'`.
- Фигуры `cornerCenter`, `cornerEdge`, `diagA`, `diagB`: по всем `ORIENTATIONS[name]`.
  Чистая версия — `owners` везде `'me'`. Смешанная — `'me'` на индексах из
  `MIXED_SHAPES.owners`, остальные `'other'`.

## 3. `scan(board, locked, me)` — один проход

Для каждого шаблона и якоря в его границах:

1. Если клетка в `locked` — шаблон не годится.
2. Для позиции `'other'`: значение должно равняться символу противника.
   Для позиции `'me'`: если там символ противника — не годится; пустую считаем.
3. Если пустых больше 3 — пропускаем.
4. Дедупликация по отсортированному списку `key` всех клеток.
5. Классификация:
   - `empty === 0` → `complete`;
   - `empty === 1` → `one = {cells, spot}`, плюс `threats: Map<spotKey, cells[]>`;
   - `empty >= 2` → `developing = {cells, spots, span, empty}`,
     `potential[k] += (span>=3 ? 5 : span>=2 ? 2 : 1)`, `cellSpan[k] = max(span)`.

`span` — число разных секторов, задетых клетками фигуры.

## 4. Статическая карта `CELL_SPAN`

Считается один раз при загрузке: для каждого шаблона, якоря и клетки
`CELL_SPAN[r][c] = max(CELL_SPAN[r][c], span)`. Это «геометрия» без привязки к партии.

## 5. Оценки

```
gainCount(cells, owned) = число секторов клеток, которых нет в owned

figureScore(cells, ctx, otherScan):
  gain = gainCount(cells, mySec)
  score = gain*gain*150 + gain*100
  если mySec.size + gain >= 3: score += 100000
  +5 за каждую клетку с символом противника внутри фигуры
  +10 за пересечение с любой фигурой otherScan.one

placementScore(r, c, ctx):
  potential[k]*6 + CELL_SPAN[r][c]*8
  +3 за каждого соседа (8 направлений) со своим символом
  +4 если сектор клетки ещё не наш
  +40 если k в threatCells
  +10000 если k в criticalThreatCells
```

`topPlacements(board, locked, ctx, n)` — n лучших пустых клеток по `placementScore`.

```
evaluate(state, me):
  (mySec.size - oppSec.size) * 2000
  + ready*90 - danger*100 + threat*30 - risk*40   // ready/danger/threat/risk — суммы level²
  + (mySpan - oppSpan) * 4                        // из cellSpan scans
  + potential*3 - oppPotential*3
  + denied*3                                      // чужие символы в моих зафиксированных клетках
```

## 6. `applyMove(state, move, me)`

Копируем `board` (строки), `locked` (Set), `owners` (Map). Ставим `me` в `move.place`.
Если есть `move.fix` — добавляем его клетки в `locked` и `owners.set(k, me)`.

## 7. `generateMoves(state, me, limit)`

Кандидаты четырёх видов:

1. Готовые фигуры (`complete`) — до двух лучших свободных размещений + `fix`.
2. Фигуры в одну клетку (`one`) — `place = spot`, `fix = cells`.
3. Блокирующие точки из `threats`:
   - угроза 3-го сектора → вес `100000`,
   - остальные → `200 + gain*50`.
4. `topPlacements` (обычно 8).

Опционально early-угрозы из `developing`: `300 + span*20`.
Дедупликация по `key(place) + '|' + отсортированные key(fix)`, сортировка по убыванию веса,
`slice(0, limit)` — обычно `limit = 10…12`.

## 8. `search` (альфа-бета)

```
terminalScore: +100000+depth если у меня 3 сектора, -100000-depth если у противника
depth <= 0 → evaluate
moves = generateMoves(state, toMove, LIMITS[3-depth])   // LIMITS = [8,5,4]
обычный alpha-beta; корневой вызов из decide делался с depth=2
```

Глубина в итоге: мой ход (уже применён) → ответ противника → мой ход → оценка.
В более ранней версии было `LIMITS=[10,6,4]` и поиск_depth=3.

## 9. `decide(board, locked, me, owners)` — каскад приоритетов

1. `mySec`, `oppSec`; `candidates = generateMoves(...)`; `own = scan(me)`; `enemy = scan(other)`.
2. `ready` — готовая фигура с максимальным `gain`; `one` — одно-клеточная с максимальным `gain`.
3. Угрозы:
   - `criticalSpots` — `enemy.one`, где `oppSec.size + gain >= 3` (или mixed с `gain >= 2`);
   - `looming` — `enemy.developing` с `empty <= 3` и (`winning` или mixed `gain >= 2`);
   - `urgent = criticalSpots.size > 0 || (looming с empty<=2 больше 1)`.
4. **Победа сейчас**: если готовая фигура даёт 3-й сектор — фиксируем, свободный символ
   ставим в лучшую не занятую фигурой клетку.
5. **Достройка победы**: если `one` даёт 3-й сектор — `place=spot`, `fix=cells`.
6. **Блок мгновенной победы противника** — если `oppCanWin`, выбираем блокирующий ход
   поиском и возвращаем его.
7. **Своя готовая фигура** с `gain >= 2` — фиксируем (если после хода противник не выигрывает сразу).
8. **Своя достройка** (`one`) — `place=spot`, `fix=cells` (если не даёт противнику мгновенную победу).
9. Иначе — поиск по всем кандидатам, лучший по `search + move.score*0.001`.

`chooseMove()` — тонкая обёртка: `decide(...).place`.

## 10. Чего в той верси

- Никаких уровней сложности, рангов ходов, `goodMoveChance`, `missBlockChance`.
- Никаких `patternGuard`, `figureGuard`, `prioritySpots`, жёстких «банов» фигур.
- Никаких принудительных фильтров «только блокировщики» — **важно**: если добавить такой
  фильтр, бот перестанет строить свои фигуры и начнёт «рандомно заливать клетки».
- Динамической карты `reachableCells` — использовалась статическая `CELL_SPAN`.
- `figureGuard`/шпаргалки с штрафами — приоритет шёл только от числа секторов.

## 11. Ключ к силе

Сильным бота делали **пункты 4–8 каскада** (мгновенные тактические решения), а не поиск.
Поиск использовался только как финальный арбитр. Именно удаление этого каскада при
введении рангов сложности и последующие «жёсткие баны» привели к просадкам.

Если пересобирать: начните с каскада, затем добавьте поиск, и только потом — по желанию —
слой сложности через **ограничение числа кандидатов**, а не через выбор 6-го из 10.
