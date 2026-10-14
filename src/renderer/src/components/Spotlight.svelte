<script lang="ts">
  import { onMount, tick } from 'svelte'
  import logoImage from '../lib/assets/images/splash.png'

  let inputEl = $state<HTMLInputElement | null>(null)
  let query = $state('')
  let images = $state<string[]>([])
  let errorMsg = $state('')
  let showHint = $state(true)

  // Bar position within the fullscreen window
  let barX = $state(0)
  let barY = $state(160)
  let screenW = $state(1920)
  let screenH = $state(1080)

  const BAR_W = 748

  const api = window.spotlightAPI

  // ─── Folder & model pickers ───
  type Model = { id: string; name: string; custom: boolean }
  type Folder = { id: string; name: string; path: string }
  type Prompt = { id: string; command: string; name: string; content: string }

  let models = $state<Model[]>([])
  let folders = $state<Folder[]>([])
  let prompts = $state<Prompt[]>([])
  let contextLoaded = $state(false)
  // Kept while the app runs so repeated Spotlight use targets the same place
  let selectedFolderId = $state<string | null>(null)
  let selectedModelId = $state<string | null>(null)
  // A prompt applies to one query only; reset after each submit
  let selectedPromptId = $state<string | null>(null)

  type PickerKind = 'folder' | 'model' | 'prompt'
  let openPicker = $state<PickerKind | null>(null)
  let pickerFilter = $state('')
  let pickerIndex = $state(0)
  let pickerInputEl = $state<HTMLInputElement | null>(null)
  let pickerListEl = $state<HTMLDivElement | null>(null)

  const selectedFolder = $derived(folders.find((f) => f.id === selectedFolderId) ?? null)
  const selectedModel = $derived(models.find((m) => m.id === selectedModelId) ?? null)
  const selectedPrompt = $derived(prompts.find((p) => p.id === selectedPromptId) ?? null)
  const hasTarget = $derived(!!selectedFolder || !!selectedModel)

  // ─── Submit mode & source app ───
  // 'send' = send right away, 'review' = open the chat pre-filled.
  // Enter uses the mode from Settings, Shift+Enter the other one.
  type SubmitMode = 'send' | 'review'
  let submitMode = $state<SubmitMode>('send')
  const otherMode = $derived<SubmitMode>(submitMode === 'send' ? 'review' : 'send')
  const MODE_LABEL: Record<SubmitMode, string> = { send: 'Send', review: 'Open chat' }
  // Shift held: Enter / click on the button use the other mode (button shows it)
  let shiftHeld = $state(false)
  const buttonMode = $derived<SubmitMode>(shiftHeld ? otherMode : submitMode)

  let sourceApp = $state<{ name: string; icon: string | null } | null>(null)

  type PickerItem = { id: string | null; label: string; sub?: string; badge?: string }
  const NONE_LABEL: Record<PickerKind, string> = {
    folder: 'No folder',
    model: 'Default model',
    prompt: 'No prompt'
  }
  const pickerItems = $derived.by((): PickerItem[] => {
    const f = pickerFilter.trim().toLowerCase()
    if (!openPicker) return []
    const none: PickerItem = { id: null, label: NONE_LABEL[openPicker] }
    const items: PickerItem[] =
      openPicker === 'folder'
        ? folders.map((x) => ({ id: x.id, label: x.path }))
        : openPicker === 'model'
          ? // Experts (workspace models with their own system prompt) first
            [...models.filter((x) => x.custom), ...models.filter((x) => !x.custom)].map((x) => ({
              id: x.id,
              label: x.name,
              sub: x.name !== x.id ? x.id : undefined,
              badge: x.custom ? 'Expert' : undefined
            }))
          : prompts.map((x) => ({ id: x.id, label: x.name, sub: `/${x.command}` }))
    const filtered = f
      ? items.filter((i) => i.label.toLowerCase().includes(f) || i.sub?.toLowerCase().includes(f))
      : items
    return f ? filtered : [none, ...filtered]
  })

  const loadContext = async (): Promise<void> => {
    const ctx = await api?.getContext?.().catch(() => null)
    if (!ctx) {
      contextLoaded = false
      return
    }
    models = ctx.models ?? []
    folders = ctx.folders ?? []
    // Drop selections that no longer exist on the server
    if (selectedFolderId && !folders.some((f) => f.id === selectedFolderId)) selectedFolderId = null
    if (selectedModelId && !models.some((m) => m.id === selectedModelId)) selectedModelId = null
    prompts = ctx.prompts ?? []
    if (selectedPromptId && !prompts.some((p) => p.id === selectedPromptId)) selectedPromptId = null
    contextLoaded = models.length > 0 || folders.length > 0 || prompts.length > 0
  }

  const currentId = (which: PickerKind | null): string | null =>
    which === 'folder' ? selectedFolderId : which === 'model' ? selectedModelId : selectedPromptId

  const togglePicker = async (which: PickerKind): Promise<void> => {
    if (openPicker === which) {
      closePicker()
      return
    }
    openPicker = which
    pickerFilter = ''
    pickerIndex = Math.max(0, pickerItems.findIndex((i) => i.id === currentId(which)))
    // Focus synchronously after render so fast typing isn't lost
    await tick()
    pickerInputEl?.focus()
    scrollPickerIntoView()
  }

  const closePicker = (): void => {
    openPicker = null
    pickerFilter = ''
    requestAnimationFrame(() => inputEl?.focus())
  }

  const choose = (item: PickerItem | undefined): void => {
    if (!item) return
    if (openPicker === 'folder') selectedFolderId = item.id
    else if (openPicker === 'model') selectedModelId = item.id
    else if (openPicker === 'prompt') selectedPromptId = item.id
    closePicker()
  }

  const scrollPickerIntoView = (): void => {
    pickerListEl?.querySelector<HTMLElement>(`[data-index="${pickerIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const onPickerKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      pickerIndex = Math.min(pickerItems.length - 1, pickerIndex + 1)
      requestAnimationFrame(scrollPickerIntoView)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      pickerIndex = Math.max(0, pickerIndex - 1)
      requestAnimationFrame(scrollPickerIntoView)
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      choose(pickerItems[pickerIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closePicker()
    }
  }

  // ─── Error Toast ───
  let errorTimer: ReturnType<typeof setTimeout> | null = null
  const showError = (msg: string, duration = 4000) => {
    errorMsg = msg
    if (errorTimer) clearTimeout(errorTimer)
    errorTimer = setTimeout(() => { errorMsg = '' }, duration)
  }

  // ─── Submit ───
  const submit = (mode: SubmitMode = submitMode): void => {
    let q = query.trim()
    if (!q && images.length === 0 && !selectedPrompt) return
    if (selectedPrompt) {
      // {{CLIPBOARD}} is where Open WebUI prompts expect the input text;
      // other variables are resolved by Open WebUI when the text is set.
      const content = selectedPrompt.content
      q = content.includes('{{CLIPBOARD}}')
        ? content.replaceAll('{{CLIPBOARD}}', () => q)
        : q
          ? `${content}\n\n${q}`
          : content
    }
    if (!api) return
    // Svelte 5 $state creates Proxy objects that Electron IPC can't serialize.
    // Spread into a plain array of plain strings for structured clone.
    const plainImages = images.length > 0 ? [...images].map((s) => s.slice(0)) : undefined
    api.submitQuery(q, plainImages, {
      folderId: selectedFolder?.id ?? null,
      modelId: selectedModel?.id ?? null,
      mode
    })
    query = ''
    images = []
    openPicker = null
    selectedPromptId = null
  }

  // ─── Bar Dragging ───
  let barDragging = $state(false)
  let barDragStart = { mx: 0, my: 0, bx: 0, by: 0 }

  const onBarMouseDown = (e: MouseEvent) => {
    // Only drag from the bar background, not from input or buttons
    const target = e.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.closest('button') ||
      target.closest('.preview') ||
      target.closest('.picker-panel')
    )
      return
    e.preventDefault()
    barDragging = true
    barDragStart = { mx: e.clientX, my: e.clientY, bx: barX, by: barY }
  }

  // ─── Region Selection ───
  let selecting = $state(false)
  let selStart = { x: 0, y: 0 }
  let selRect = $state({ x: 0, y: 0, w: 0, h: 0 })
  let didDrag = false
  const DRAG_THRESHOLD = 8

  const onWrapperMouseDown = (e: MouseEvent) => {
    // Ignore if it's on the bar or preview
    if ((e.target as HTMLElement).closest('.bar') || (e.target as HTMLElement).closest('.preview')) return
    e.preventDefault()
    selStart = { x: e.clientX, y: e.clientY }
    selecting = true
    didDrag = false
    selRect = { x: e.clientX, y: e.clientY, w: 0, h: 0 }
  }

  const onMouseMove = (e: MouseEvent) => {
    if (barDragging) {
      const dx = e.clientX - barDragStart.mx
      const dy = e.clientY - barDragStart.my
      barX = Math.max(0, Math.min(screenW - BAR_W, barDragStart.bx + dx))
      barY = Math.max(0, Math.min(screenH - 60, barDragStart.by + dy))
      return
    }
    if (selecting) {
      const dx = e.clientX - selStart.x
      const dy = e.clientY - selStart.y
      if (!didDrag && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        didDrag = true
      }
      selRect = {
        x: Math.min(e.clientX, selStart.x),
        y: Math.min(e.clientY, selStart.y),
        w: Math.abs(dx),
        h: Math.abs(dy)
      }
    }
  }

  const onMouseUp = async (e: MouseEvent) => {
    if (barDragging) {
      barDragging = false
      api?.savePosition({ x: barX, y: barY })
      return
    }
    if (selecting) {
      selecting = false
      showHint = false
      if (didDrag && selRect.w > 10 && selRect.h > 10) {
        // Capture the selected region
        const result = await api?.captureRegion({
          x: selRect.x,
          y: selRect.y,
          width: selRect.w,
          height: selRect.h
        })
        if (result === 'no-permission') {
          showError('Screen Recording permission required. Opening System Settings…')
        } else if (result && typeof result === 'string' && result.startsWith('data:')) {
          images = [...images, result]
        } else if (!result) {
          showError('Screenshot capture failed.')
        }
        selRect = { x: 0, y: 0, w: 0, h: 0 }
      } else {
        // Click on background (not a drag) — dismiss
        selRect = { x: 0, y: 0, w: 0, h: 0 }
        api?.closeSpotlight()
      }
    }
  }

  const removeImage = (index: number) => {
    images = images.filter((_, i) => i !== index)
  }

  onMount(() => {
    inputEl?.focus()
    window.addEventListener('focus', () => {
      inputEl?.focus()
    })

    api?.onInit?.((data) => {
      openPicker = null
      sourceApp = data.sourceApp ?? null
      submitMode = data.submitMode === 'review' ? 'review' : 'send'
      // Start from the defaults chosen in Settings (validated once loaded)
      selectedFolderId = data.defaults?.folderId ?? null
      selectedModelId = data.defaults?.modelId ?? null
      selectedPromptId = data.defaults?.promptId ?? null
      loadContext()
      if (data.screenSize) {
        screenW = data.screenSize.width
        screenH = data.screenSize.height
      }
      if (data.barOffset) {
        barX = data.barOffset.x
        barY = data.barOffset.y
      } else {
        // Default: center horizontally, near top
        barX = Math.round((screenW - BAR_W) / 2)
        barY = 160
      }
      if (data.query) {
        query = data.query
        requestAnimationFrame(() => inputEl?.select())
      }
      requestAnimationFrame(() => inputEl?.focus())

      // Show screenshot hint
      showHint = true
    })
  })
</script>

<svelte:window
  onkeydown={(e) => {
    shiftHeld = e.shiftKey
    if (e.key !== 'Escape') return
    if (openPicker) closePicker()
    else api?.closeSpotlight()
  }}
  onkeyup={(e) => (shiftHeld = e.shiftKey)}
  onblur={() => (shiftHeld = false)}
  onmousemove={onMouseMove}
  onmouseup={onMouseUp}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="wrapper" onmousedown={onWrapperMouseDown}>
  <!-- Screen capture overlay -->
  {#if selecting && didDrag}
    <!-- Selection with shadow-based dimming -->
    <div
      class="selection"
      style="left:{selRect.x}px;top:{selRect.y}px;width:{selRect.w}px;height:{selRect.h}px"
    >
      <div class="handle tl"></div>
      <div class="handle tr"></div>
      <div class="handle bl"></div>
      <div class="handle br"></div>
    </div>
    <!-- Dimensions label -->
    <div
      class="dimensions"
      style="left:{selRect.x + selRect.w / 2}px;top:{selRect.y + selRect.h + 12}px"
    >
      {Math.round(selRect.w)} × {Math.round(selRect.h)}
    </div>
  {/if}

  <!-- Floating bar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bar"
    style="left:{barX}px;top:{barY}px"
    onmousedown={onBarMouseDown}
  >
    {#if images.length > 0}
      <div class="attachments">
        {#each images as img, i}
          <div class="preview-item">
            <img src={img} alt="Screenshot {i + 1}" />
            <button class="preview-remove" onclick={() => removeImage(i)} aria-label="Remove">×</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if sourceApp}
      <div class="source-app">
        {#if sourceApp.icon}<img src={sourceApp.icon} alt="" />{/if}
        <span>Working with <strong>{sourceApp.name}</strong></span>
      </div>
    {/if}

    <div class="input-row">
      <img class="logo" src={logoImage} alt="" />

      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder="What can I help you with today?"
        autocomplete="off"
        spellcheck="false"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault()
            submit(e.shiftKey ? otherMode : submitMode)
          }
        }}
      />

      <button class="send" class:active={query.trim().length > 0 || images.length > 0 || !!selectedPrompt} aria-label={MODE_LABEL[buttonMode]} title="{MODE_LABEL[submitMode]} (click / ↵) · {MODE_LABEL[otherMode]} (⇧ click / ⇧↵)" onclick={(e) => submit(e.shiftKey ? otherMode : submitMode)}>
        {#if buttonMode === 'send'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        {:else}
          <!-- Open chat: pre-fill without sending -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 4h6v6" />
            <path d="M20 4l-9 9" />
            <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
          </svg>
        {/if}
      </button>
    </div>

    {#if contextLoaded}
      <div class="context-row">
        {#if folders.length > 0}
          <button
            class="chip"
            class:selected={!!selectedFolder}
            class:open={openPicker === 'folder'}
            onclick={() => togglePicker('folder')}
            title="Open the chat in a folder"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            <span class="chip-label">{selectedFolder?.path ?? 'No folder'}</span>
            <svg class="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        {/if}
        {#if models.length > 0}
          <button
            class="chip"
            class:selected={!!selectedModel}
            class:open={openPicker === 'model'}
            onclick={() => togglePicker('model')}
            title="Choose the model for this chat"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5" /><path d="M12 12v9" /><path d="M12 12L4 7.5" />
            </svg>
            <span class="chip-label">{selectedModel?.name ?? 'Default model'}</span>
            <svg class="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        {/if}
        {#if prompts.length > 0}
          <button
            class="chip"
            class:selected={!!selectedPrompt}
            class:open={openPicker === 'prompt'}
            onclick={() => togglePicker('prompt')}
            title="Apply one of your Open WebUI prompts to the text"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 17l6-6-6-6" /><path d="M12 19h8" />
            </svg>
            <span class="chip-label">{selectedPrompt?.name ?? 'No prompt'}</span>
            <svg class="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        {/if}

        <span class="context-note">
          {#if images.length > 0 && hasTarget}
            Screenshots go to a new default chat
          {:else}
            <kbd>↵</kbd> {MODE_LABEL[submitMode]} · <kbd>⇧</kbd> {MODE_LABEL[otherMode]}
          {/if}
        </span>
      </div>

      {#if openPicker}
        <div class="picker-panel">
          <input
            bind:this={pickerInputEl}
            bind:value={pickerFilter}
            class="picker-search"
            type="text"
            placeholder={openPicker === 'folder'
              ? 'Search folders…'
              : openPicker === 'model'
                ? 'Search models and experts…'
                : 'Search prompts…'}
            autocomplete="off"
            spellcheck="false"
            oninput={() => (pickerIndex = 0)}
            onkeydown={onPickerKeydown}
          />
          <div class="picker-list" bind:this={pickerListEl}>
            {#each pickerItems as item, i (item.id ?? '__none')}
              <button
                class="picker-item"
                class:active={i === pickerIndex}
                class:current={item.id === currentId(openPicker)}
                data-index={i}
                onmouseenter={() => (pickerIndex = i)}
                onclick={() => choose(item)}
              >
                <span class="picker-item-label" class:muted={item.id === null}>{item.label}</span>
                {#if item.badge}<span class="picker-badge">{item.badge}</span>{/if}
                {#if item.sub}<span class="picker-item-sub">{item.sub}</span>{/if}
              </button>
            {:else}
              <div class="picker-empty">No match</div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Screenshot hint -->
  {#if showHint && images.length === 0 && !selecting}
    <div class="hint">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 8V6a2 2 0 012-2h2" /><path d="M4 16v2a2 2 0 002 2h2" /><path d="M16 4h2a2 2 0 012 2v2" /><path d="M16 20h2a2 2 0 002-2v-2" />
      </svg>
      Drag anywhere to capture a screenshot
    </div>
  {/if}

  <!-- Error toast -->
  {#if errorMsg}
    <div class="error-toast">{errorMsg}</div>
  {/if}
</div>

<style>
  @font-face {
    font-family: 'Archivo';
    src: url('../lib/assets/fonts/Archivo-Variable.ttf');
    font-display: swap;
  }
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(html), :global(body), :global(#app) {
    height: 100%;
    width: 100%;
    background: transparent;
    overflow: hidden;
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }

  .wrapper {
    position: fixed;
    inset: 0;
    cursor: crosshair;
  }

  .selection {
    position: absolute;
    border: 2px solid rgba(255, 255, 255, 0.9);
    border-radius: 2px;
    pointer-events: none;
    z-index: 10;
    /* Massive spread shadow dims everything outside the selection */
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  }

  .handle {
    position: absolute;
    width: 6px;
    height: 6px;
    background: white;
    border-radius: 1px;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
  }
  .handle.tl { top: -3px; left: -3px; }
  .handle.tr { top: -3px; right: -3px; }
  .handle.bl { bottom: -3px; left: -3px; }
  .handle.br { bottom: -3px; right: -3px; }

  .dimensions {
    position: absolute;
    transform: translateX(-50%);
    padding: 3px 8px;
    border-radius: 4px;
    font-family: 'Archivo', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    pointer-events: none;
    z-index: 11;
    white-space: nowrap;
  }

  .bar {
    position: absolute;
    width: 748px;
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    font-family: 'Archivo', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    cursor: grab;
    z-index: 100;
    overflow: hidden;

    background: #f5f5f7;
    color: #1d1d1f;
    border: 0.5px solid rgba(0, 0, 0, 0.08);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.06),
      0 8px 24px rgba(0, 0, 0, 0.1);
  }

  @media (prefers-color-scheme: dark) {
    .bar {
      background: #1a1a1c;
      color: #fafafa;
      border-color: rgba(255, 255, 255, 0.08);
      box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.2),
        0 8px 24px rgba(0, 0, 0, 0.35);
    }
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 52px;
    padding: 0 9px 0 15px;
  }

  .logo {
    width: 25px;
    height: 25px;
    flex-shrink: 0;
    object-fit: contain;
    opacity: 0.8;
  }

  @media (prefers-color-scheme: dark) {
    .logo { filter: invert(1); }
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-family: inherit;
    font-size: 17px;
    font-weight: 450;
    line-height: 1;
    letter-spacing: -0.01em;
    color: #1d1d1f;
    cursor: text;
  }

  input::placeholder {
    color: rgba(0, 0, 0, 0.22);
  }

  @media (prefers-color-scheme: dark) {
    input { color: #fafafa; }
    input::placeholder { color: rgba(255, 255, 255, 0.18); }
  }

  .send {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    outline: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s ease;

    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.18);
  }

  .send.active {
    background: #1d1d1f;
    color: #fff;
  }

  .send.active:hover { opacity: 0.8; }
  .send.active:active { transform: scale(0.92); }

  @media (prefers-color-scheme: dark) {
    .send {
      background: rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.15);
    }
    .send.active {
      background: #fafafa;
      color: #1d1d1f;
    }
  }

  /* ─── Folder / Model pickers ─── */
  .context-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px 10px 12px;
    margin-top: -4px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 200px;
    flex-shrink: 0;
    height: 26px;
    padding: 0 8px 0 9px;
    border: none;
    outline: none;
    border-radius: 8px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
    background: rgba(0, 0, 0, 0.04);
    color: rgba(0, 0, 0, 0.5);
  }
  .chip:hover, .chip.open, .chip:focus-visible { background: rgba(0, 0, 0, 0.08); color: rgba(0, 0, 0, 0.75); }
  .chip.selected { color: #1d1d1f; background: rgba(0, 0, 0, 0.08); }
  .chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { flex-shrink: 0; opacity: 0.6; }

  .source-app {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 15px 0;
    font-size: 12.5px;
    color: rgba(0, 0, 0, 0.5);
  }
  .source-app img { width: 16px; height: 16px; object-fit: contain; }
  .source-app strong { font-weight: 600; color: rgba(0, 0, 0, 0.75); }

  .context-note kbd {
    font-family: inherit;
    font-size: 11px;
    padding: 0 4px;
    border-radius: 4px;
    border: 0.5px solid rgba(0, 0, 0, 0.15);
  }

  .context-note {
    margin-left: auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11.5px;
    color: rgba(0, 0, 0, 0.35);
    white-space: nowrap;
  }

  .picker-panel {
    border-top: 0.5px solid rgba(0, 0, 0, 0.08);
    padding: 8px;
    cursor: default;
  }

  .picker-search {
    width: 100%;
    height: 30px;
    padding: 0 8px;
    font-size: 13.5px;
    border-radius: 7px;
    background: rgba(0, 0, 0, 0.04);
  }

  .picker-list {
    margin-top: 6px;
    max-height: 232px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .picker-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 6px 8px;
    border: none;
    outline: none;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
  }
  .picker-item.active { background: rgba(0, 0, 0, 0.06); }
  .picker-item.current .picker-item-label { font-weight: 600; }
  .picker-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picker-item-label.muted { opacity: 0.55; }
  .picker-item-sub {
    margin-left: auto;
    flex-shrink: 0;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    opacity: 0.4;
  }
  .picker-badge {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    background: rgba(0, 0, 0, 0.06);
    opacity: 0.7;
  }
  .picker-empty { padding: 8px; font-size: 13px; opacity: 0.4; }

  @media (prefers-color-scheme: dark) {
    .chip { background: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.45); }
    .chip:hover, .chip.open, .chip:focus-visible { background: rgba(255, 255, 255, 0.09); color: rgba(255, 255, 255, 0.8); }
    .chip.selected { color: #fafafa; background: rgba(255, 255, 255, 0.09); }
    .context-note { color: rgba(255, 255, 255, 0.3); }
    .context-note kbd { border-color: rgba(255, 255, 255, 0.18); }
    .source-app { color: rgba(255, 255, 255, 0.45); }
    .source-app strong { color: rgba(255, 255, 255, 0.8); }
    .picker-panel { border-top-color: rgba(255, 255, 255, 0.08); }
    .picker-search { background: rgba(255, 255, 255, 0.05); }
    .picker-item.active { background: rgba(255, 255, 255, 0.07); }
    .picker-badge { background: rgba(255, 255, 255, 0.08); }
  }

  /* ─── Inline Attachments ─── */
  .attachments {
    display: flex;
    gap: 6px;
    padding: 10px 12px 0;
    flex-wrap: wrap;
  }

  .preview-item {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .preview-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .preview-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font-size: 12px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .preview-item:hover .preview-remove {
    opacity: 1;
  }

  /* ─── Error Toast ─── */
  .error-toast {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    border-radius: 10px;
    font-family: 'Archivo', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    background: rgba(220, 38, 38, 0.9);
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    z-index: 200;
    pointer-events: none;
    animation: toast-in 0.25s ease-out;
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateX(-50%) translateY(10px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  /* ─── Screenshot Hint ─── */
  .hint {
    position: fixed;
    bottom: 48px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 10px;
    font-family: 'Archivo', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    font-size: 13px;
    font-weight: 450;
    z-index: 200;
    pointer-events: none;
    animation: hint-in 0.25s ease-out;

    color: rgba(255, 255, 255, 0.8);
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 0.5px solid rgba(255, 255, 255, 0.1);
  }

  @keyframes hint-in {
    from { opacity: 0; transform: translateX(-50%) translateY(6px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
