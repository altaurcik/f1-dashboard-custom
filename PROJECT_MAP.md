# Карта F1 Dashboard Custom

Правила работы — [AGENTS.md](AGENTS.md).
Независимые бесплатные источники всех полей, проверки и план миграции — [DATA_SOURCES.md](DATA_SOURCES.md). Эта карта описывает текущую реализацию, а не историю задач.

## Назначение и основной экран

`/dashboard` — Live Timing, построенный по визуальному устройству
[Formula 1 Dashboard](https://app.formula1dashboard.com/live-timing/):
таблица Timing/Stints, карта 2D/3D, Telemetry, Best Lap Benchmarks, Race Control и Team Radio.
Боковой навигационной панели на этом экране нет по прямому указанию пользователя.

Есть три компоновки: Side by side, Stacked и Three columns; обычная/компактная плотность,
светлая/тёмная тема, выбор до двух пилотов и TV Sync. Настройки сохраняются в localStorage.
Данные настоящие: рабочий режим не запускает `mock-realtime.py` и не подменяет live-фид фикстурами.
Подложка и здания карты приглушены до тёмно-серых тонов; трек и пилоты сохраняют контраст.
Коды пилотов находятся над точками в 3D/2D и управляются переключателем Driver codes.
Они включены по умолчанию; версия 1 сохранённых настроек включает их один раз при миграции,
а дальнейший выбор пользователя сохраняется.

Стек: Next.js 16, React 19, TypeScript strict, Tailwind 4, Zustand, Lucide React,
MapLibre GL и Three.js. Точные версии — [package.json](package.json), [yarn.lock](yarn.lock).

## Маршруты и точки входа

| Маршрут | Ответственный файл |
| --- | --- |
| `/dashboard` | [src/app/dashboard/page.tsx](src/app/dashboard/page.tsx) → [LiveTiming.tsx](src/components/live/LiveTiming.tsx) |
| Общий поток страниц dashboard | [src/app/dashboard/layout.tsx](src/app/dashboard/layout.tsx) |
| `/dashboard/driver/[nr]` | [src/app/dashboard/driver/[nr]/page.tsx](src/app/dashboard/driver/[nr]/page.tsx) |
| `/dashboard/track-map` | [src/app/dashboard/track-map/page.tsx](src/app/dashboard/track-map/page.tsx) |
| `/dashboard/standings` | [src/app/dashboard/standings/page.tsx](src/app/dashboard/standings/page.tsx) |
| `/dashboard/weather` | [src/app/dashboard/weather/page.tsx](src/app/dashboard/weather/page.tsx) |
| `/dashboard/settings` | [src/app/dashboard/settings/page.tsx](src/app/dashboard/settings/page.tsx) |
| `/`, `/schedule`, `/help` | Соответствующие страницы в `src/app/(nav)`; `(nav)` не входит в URL |
| `GET /api/live-context` | [src/app/api/live-context/route.ts](src/app/api/live-context/route.ts): метаданные трассы, предыдущая редакция сессии, рекорды, изображения |
| `GET /api/circuit-geometry` | [src/app/api/circuit-geometry/route.ts](src/app/api/circuit-geometry/route.ts): локальная география по проверенному имени файла |
| `GET/POST /api/radio-transcript` | [src/app/api/radio-transcript/route.ts](src/app/api/radio-transcript/route.ts): наличие конфигурации / транскрипция |

[LegacyDashboardChrome.tsx](src/components/live/LegacyDashboardChrome.tsx) сохраняет прежние
панели сессии для вспомогательных страниц. Новый интерфейс применяется к `/dashboard`.
[src/app/layout.tsx](src/app/layout.tsx) задаёт шрифты, OLED-режим и публичный скрипт окружения.
Скрипт расположен первым в body и выполняется beforeInteractive, чтобы вставляемые
расширениями скрипты в head не подменяли его при гидратации.

## Откуда приходят данные

```text
Публичный SignalR/WebSocket relay или прямой сервер F1
  -> tools/f1-live.cjs (127.0.0.1:4000): initial/update через SSE
  -> useSocket -> useDataEngine
  -> Zustand: состояние сессии, телеметрия и позиции
  -> таблица, заголовок, карточки событий и радио

Position.z -> positionTimeline: кадры с метками времени, буфер 2 секунды
  -> интерполяция в requestAnimationFrame
  -> 2D SVG и географическая карта/модели автомобилей

Публичный REST API референса -> /api/live-context
  -> ReferenceContext -> рекорды, предыдущая сессия, география и изображения
```

Координаты распаковываются сразу при поступлении Position.z, без опроса архива.
Общий таймер Zustand обновляется раз в 100 мс; карта читает позиционный timeline напрямую
и интерполирует кадры в requestAnimationFrame с буфером 2 секунды.
3D-слой автомобилей запрашивает следующий кадр MapLibre через triggerRepaint, пока
детальные модели видимы: их анимация не должна зависеть от частоты входящих пакетов.
Частота отрисовки зависит от экрана и нагрузки; частота исходных измерений задаётся источником.
CHEQUERED и Finished не останавливают позиционный timeline: карта движется до последнего
реального кадра, включая возвращение пилотов в пит-лейн. Затем удерживает последнюю позицию.
Свежесть проверяется также по UTC последнего исходного кадра, поэтому повторный initial
со старой позицией не делает поток свежим. При остановке отображается Positions paused
со временем последнего кадра; эта отметка не управляет анимацией.

Подтверждено при чтении кода и сетевого потока референса:

- `wss://livetiming.formula1dashboard.com/` отдаёт `Position.z`, `CarData.z` и timing topics.
- `https://api.formula1dashboard.com/api/v1/` отдаёт sessions, drivers, grand-prix и laps.
- Прямой анонимный F1 подтверждён на активной сессии: обновления TimingData/TimingAppData/TimingStats;
  Position.z/CarData.z в snapshot и обновлениях не было. Подробности и границы проверки — DATA_SOURCES.md.
- Реальный upstream внутри стороннего relay не установлен. Нельзя утверждать, что мы знаем,
  как его владелец получает координаты или использует F1TV.

[tools/f1-live.cjs](tools/f1-live.cjs) принимает `F1_LIVE_WEBSOCKET_URL` из `.env.local`.
Если переменной нет, выполняет negotiation с `livetiming.formula1.com/signalrcore`.
Поддерживает транспортные ping/pong и SignalR ping; переподписывается при смене сессии.
Обновление SessionInfo с тем же именем не должно сбрасывать соединение.
Сжатые поля преобразует в `CarDataZ`/`PositionZ`, имена SSE остаются `initial`/`update`.

HTTP адаптера: `/api/health`, `/api/current`, `/api/drivers`, `/api/realtime`.
Рабочая конфигурация пока остаётся на relay/REST референса; это технический долг, а не завершённая независимая интеграция.
Team Radio MP3 на новом экране читается напрямую с `livetiming.formula1.com/static/`.
RAIN — признак дождя (Yes/No), а не миллиметры.
[tools/check-data-sources.cjs](tools/check-data-sources.cjs) проверяет независимые архивы без аккаунта;
[docs/data-source-audit.json](docs/data-source-audit.json) сохраняет результат с временем проверки.
Проверка не подмешивает архивные данные в рабочий live.

Health сообщает источник, соединение, время последнего обновления и ошибку;
успешный HTTP не означает, что сессия идёт или приходят новые координаты.
CORS разрешает localhost и 127.0.0.1 на порту 3000.

Сторонние live/REST-сервисы находятся вне этого репозитория. Их доступность и формат могут измениться.
Адаптер использует внутренний `next/dist/compiled/ws`; при обновлении Next.js проверять совместимость.

## Ключевые модули

| Область | Файлы и ответственность |
| --- | --- |
| Экран, таблица, Stints, Telemetry, Benchmarks, TV Sync | [LiveTiming.tsx](src/components/live/LiveTiming.tsx) |
| Согласованность тайминга | [timingConsistency.ts](src/lib/timingConsistency.ts): удалённый LAST, отсутствие GAP без текущего BEST, завершение этапов квалификации; [аудит](docs/data-audits/2026-10-09-sprint-qualifying.md) |
| Дистанция шин | [StintTimeline.tsx](src/components/live/StintTimeline.tsx): полосы, маркеры и общая ось; [stintTimeline.ts](src/lib/stintTimeline.ts): масштаб и отрезки комплектов |
| Оформление и адаптивность | [live-timing.css](src/components/live/live-timing.css) |
| Иконки | [Icon.tsx](src/components/live/Icon.tsx): Lucide |
| Настройки компоновки и карты | [useLivePreferences.ts](src/stores/useLivePreferences.ts): localStorage `live-timing-preferences`, отложенная гидратация |
| Состояние соединения | [LiveConnection.tsx](src/components/live/LiveConnection.tsx) |
| Исторические данные | [ReferenceContext.tsx](src/components/live/ReferenceContext.tsx), [live-context.type.ts](src/types/live-context.type.ts) |
| Карточки и уведомления | [EventPanels.tsx](src/components/live/EventPanels.tsx): категории/фильтры, счётчики, портреты, аудио, тосты, звук и desktop notifications |
| Географическая карта | [GeographicTrackScene.tsx](src/components/live/GeographicTrackScene.tsx): MapLibre, здания, пит-лейн, повороты, флаги и камеры |
| 3D-модели машин | [vehicleLayer.ts](src/lib/vehicleLayer.ts): Three.js в общем GL-контексте карты, цвета команд и составов шин |
| 2D-карта | [Map.tsx](src/components/dashboard/Map.tsx), [map.ts](src/lib/map.ts), [fetchMap.ts](src/lib/fetchMap.ts) |
| Область действия флагов | [trackFlags.ts](src/lib/trackFlags.ts): общий/локальный жёлтый и CLEAR, единая логика для 3D/2D; [circuitFlagSectors.ts](src/lib/circuitFlagSectors.ts): разрезание контура по реальным маршальским границам |
| Позиционные кадры | [positionTimeline.ts](src/lib/positionTimeline.ts): сортировка, буфер, интерполяция; без экстраполяции через разрывы и смену статуса |
| SSE и обработка данных | [useSocket.ts](src/hooks/useSocket.ts), [useDataEngine.ts](src/hooks/useDataEngine.ts) |
| Буферы и состояние | [useBuffer.ts](src/hooks/useBuffer.ts), [useStatefulBuffer.ts](src/hooks/useStatefulBuffer.ts), [useStores.ts](src/hooks/useStores.ts), [useDataStore.ts](src/stores/useDataStore.ts) |
| Прежние настройки | [useSettingsStore.ts](src/stores/useSettingsStore.ts): localStorage `settings-storage`; задержка, звук, настройки 2D |
| Контракты | [state.type.ts](src/types/state.type.ts), [message.type.ts](src/types/message.type.ts), [live-view.type.ts](src/types/live-view.type.ts) |

В Timing сохраняются POS, DRIVER, GAP, INT, LAST, BEST, MINI-SECTORS, LAPS, PIT и TYRE;
после TYRE добавлена STINT HISTORY. В Stints остаются POS, DRIVER, GAP, INT, LAPS, PIT,
TYRE и STINT HISTORY. Узкая компоновка сохраняет все столбцы с прокруткой внутри таблицы.
Шкала одинакова для всех пилотов: в Race/Sprint — LapCount.TotalLaps, в остальных сессиях —
максимум TimingData.NumberOfLaps. Без полной дистанции гонки масштаб не подменяется
пройденными кругами. TYRE показывает возраст комплекта, полоса — дистанцию в текущей сессии.
Использованные комплекты отмечаются штриховкой; TyresNotChanged объединяет продолжение
того же комплекта, а не создаёт ложную смену шин. LapNumber в Stints не используется
как подтверждённая граница смены комплекта.
GAP/INT квалификации берутся из Stats текущего SessionPart; для выбывших пилотов
доступна последняя заполненная часть. DNF применяется к Retired, а не к KnockedOut.
Регрессии расчётов: `node tools/test-stint-timeline.cjs`.
В квалификации пустой BEST не заполняется временем предыдущего этапа; GAP/INT без него
не показываются. Удалённый LAST отмечается по совпадению пилота, времени и номера круга
с Race Control; физическое число кругов сохраняется. PIT считывает NumberOfPitStops.
Finished при Part 1/2 означает окончание этапа; полное завершение — SQ3 Finished, Ends/Finalised.
Регрессии согласованности: `node tools/test-timing-consistency.cjs`.
Sentinel-значения педалей вне диапазона 0–100 показываются как отсутствие данных.

События INCIDENT/NOTED/INVESTIGATED представлены как Investigation с фиолетовой карточкой;
штрафы — красные, остальные сообщения Info остаются нейтральными.
Всплывающие уведомления размещаются справа внизу; колокольчик управляет их включением.
Уведомления создаются только для новых сообщений: уже загруженная история учитывается
при монтировании подписчика, а смена сессии очищает старые тосты и таймеры.
Звук включается отдельно; разрешение на desktop notifications запрашивается только после
действия пользователя в настройках событий.
Регрессии категорий и уведомлений: `node tools/test-event-notifications.cjs`.

## География и визуальные ресурсы

- `public/circuits`: локальные GeoJSON трасс из публичного CDN референса;
  метаданные, включая указанные ссылки на OpenStreetMap для пит-лейнов, сохранены.
- `public/reference-assets/logos` и `public/reference-assets/portraits`: публичные миниатюры,
  загруженные оригинальной страницей. Локальные копии устраняют блокировку CDN для localhost.
- [f1-2026-simplified.glb](public/models/f1-2026-simplified.glb): модель, которую загружает референс
  из `https://app.formula1dashboard.com/models/f1-2026-simplified.glb`.
- `public/tires`, `public/flags`, `public/team-logos`, `public/sounds`: существующие ресурсы проекта.

Географическая калибровка использует position_x/y_min/max и границы трассы.
Это отображение настоящих локальных координат F1 на географию, а не утверждение о точности GPS.
Если географии нет, интерфейс переключается на существующую 2D-карту.
При отсутствии позиционных кадров её fallback по мини-секторам остаётся расчётным.

Текущая подложка и здания — MapLibre/OpenFreeMap/OpenStreetMap. У референса используются Mapbox
и его 3D-тайлы. Подложка не является буквальной копией Mapbox: для неё нужен публичный token
аккаунта пользователя. В момент подготовки этой карты `NEXT_PUBLIC_MAPBOX_TOKEN` не был настроен.
Не называть визуальное совпадение полной страницы 1:1, пока эта разница остаётся.

Локальные YELLOW/DOUBLE YELLOW определяются по RaceControlMessages.Scope = Sector и Sector.
Только действующий Scope = Track окрашивает весь трек жёлтым; общий TrackStatus Yellow
сам по себе не сообщает область действия. CLEAR сектора снимает локальную подсветку,
Track CLEAR сбрасывает общий флаг и локальные предупреждения; RED/SC/VSC имеют приоритет.
В 3D границы берутся из flagZones GeoJSON, а при их отсутствии — из marshalSectors
существующего fetchMap с той же калибровкой координат. Неизвестную границу не заменять
равномерным делением контура или подсветкой всей трассы. В 2D используются те же правила флагов.
Регрессии области действия, CLEAR и геометрии: `node tools/test-track-flags.cjs`.

## Запуск и проверки

Node.js, рекомендуемый репозиторием: [.nvmrc](.nvmrc), 24.13.0; локально также использовался 22.13.1.
Yarn через Corepack, версия в packageManager. [.yarnrc.yml](.yarnrc.yml) использует node-modules.

```powershell
corepack yarn install --immutable
# Только если .env.local ещё нет:
Copy-Item .env.example .env.local
```

Из корня проекта в двух терминалах:

```powershell
node tools/f1-live.cjs
```

```powershell
corepack yarn dev --hostname 127.0.0.1 --port 3000
```

Открыть `http://127.0.0.1:3000/dashboard`.

| Настройка | Назначение |
| --- | --- |
| `NEXT_PUBLIC_LIVE_URL` | SSE-сервис; локально `http://localhost:4000` |
| `F1_LIVE_WEBSOCKET_URL` | Необязательный SignalR relay; локально настроен публичный источник референса |
| `API_URL` | Старый отдельный API расписания; пример `http://localhost:4001`, самим этим проектом не запускается |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Публичный token для планируемого подключения идентичной Mapbox-подложки; текущая карта работает без него через MapLibre |
| `WHISPER_PYTHON`, `HF_TOKEN` | Необязательная транскрипция через Python/WhisperX; token остаётся серверным |
| `WHISPER_MODEL`, `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE` | Параметры распознавания |
| `WHISPER_NUM_SPEAKERS`, `WHISPER_MIN_SPEAKERS`, `WHISPER_MAX_SPEAKERS` | Диаризация |
| `TRACKING_ID`, `TRACKING_URL` | Необязательная аналитика |

Транскрипция: [tools/transcribe_radio.py](tools/transcribe_radio.py),
[tools/whisper-requirements.txt](tools/whisper-requirements.txt), `.cache/radio-transcripts`.
Python-путь выбирается по платформе: Scripts/python.exe на Windows, bin/python на остальных системах.
GET статуса возвращает available; POST без конфигурации возвращает TRANSCRIPTION_UNAVAILABLE/503.
В новом радио основное отображение — портрет, имя, время и воспроизведение записи.

```powershell
corepack yarn exec tsc --noEmit
corepack yarn lint
corepack yarn build
node --check tools/f1-live.cjs
```

Проверять изменённые компоненты в браузере: Timing/Stints, плотность, выбор пилотов, обе карты,
камеры, все компоновки, тему после перезагрузки, мобильный экран и появление нового уведомления.
Тестовые фикстуры допускаются только в изолированных проверках.

Не считать любой список команд заявлением об их успешном выполнении.
В [.gitignore](.gitignore) исключены .env.local, node_modules, .next, .yarn, .cache, логи и venv.
`.cache/f1-dash-services` — исследовательская копия upstream Rust-сервисов, не часть рабочего запуска.
Там не вносить постоянные изменения. `mock-realtime.py` — отдельный демогенератор, не рабочий источник.

## Проектные скиллы

[UI UX Pro Max 2.13.0](.agents/skills/ui-ux-pro-max/SKILL.md) — локальный источник
рекомендаций по интерфейсам, таблицам, плотности, доступности и адаптивности.
Полная копия из фронтенда Roblox Discovery: scripts, data, references, LICENSE и SOURCE.json.
Upstream-коммит закреплён: `477bcb28c9812b385cb51a4605ddf30d7b2266e2`.
Порядок применения и команды — [.agents/skills/README.md](.agents/skills/README.md);
перед UI-задачами скилл подключается через AGENTS.md.

ESLint проверяет рабочие исходники; `.cache`, `.next` и `.yarn` исключены как временные/сгенерированные.
Правила TypeScript применяются к ts/tsx/mts/cts; Node CommonJS-утилиты проверяются как JavaScript.
Legacy DelayInput синхронизирует внешнюю паузу и задержку через подписки Zustand с очисткой при размонтировании.
