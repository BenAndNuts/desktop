import { ipcRenderer, contextBridge } from 'electron'

export type SpotlightTarget = {
  folderId?: string | null
  modelId?: string | null
  mode?: 'send' | 'review'
}

export type SpotlightContext = {
  models: { id: string; name: string; custom: boolean }[]
  folders: { id: string; name: string; path: string }[]
  prompts: { id: string; command: string; name: string; content: string }[]
}

const api = {
  submitQuery: (query: string, images?: string[], target?: SpotlightTarget): void => {
    ipcRenderer.invoke('spotlight:submit', query, images, target)
  },
  // Models, folders (projects) and prompts of the default connection, or null when
  // unavailable (no connection / not signed in).
  getContext: (): Promise<SpotlightContext | null> => {
    return ipcRenderer.invoke('spotlight:getContext')
  },
  closeSpotlight: (): void => {
    ipcRenderer.invoke('spotlight:close')
  },
  captureRegion: (rect: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<string | null> => {
    return ipcRenderer.invoke('spotlight:captureRegion', rect)
  },
  savePosition: (offset: { x: number; y: number }): void => {
    ipcRenderer.invoke('spotlight:savePosition', offset)
  },
  onInit: (
    callback: (data: {
      barOffset: { x: number; y: number } | null
      screenSize: { width: number; height: number }
      query: string
      sourceApp: { name: string; icon: string | null } | null
      defaults: { folderId: string | null; modelId: string | null; promptId: string | null }
      submitMode: 'send' | 'review'
    }) => void
  ): void => {
    ipcRenderer.on('spotlight:init', (_event, data) => {
      callback(data)
    })
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('spotlightAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.spotlightAPI = api
}
