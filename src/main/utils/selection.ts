import { app, clipboard } from 'electron'
import path from 'path'
import log from 'electron-log'

// ─── Foreground app & selected-text capture ─────────────
// Identifies the foreground application and grabs the text selected in it
// by simulating the system copy shortcut, then restores the user's
// clipboard. Windows only for now (Win32 via koffi, no native build step);
// other platforms return null and Spotlight falls back to the clipboard.

const VK_SHIFT = 0x10
const VK_CONTROL = 0x11
const VK_MENU = 0x12 // Alt
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const VK_C = 0x43
const KEYEVENTF_KEYUP = 0x0002

type Win32 = {
  GetAsyncKeyState: (vKey: number) => number
  keybd_event: (bVk: number, bScan: number, dwFlags: number, dwExtraInfo: number) => void
  GetForegroundWindow: () => unknown
  GetWindowThreadProcessId: (hWnd: unknown, pid: number[]) => number
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown
  QueryFullProcessImageNameW: (h: unknown, flags: number, buf: Buffer, size: number[]) => boolean
  CloseHandle: (h: unknown) => boolean
  GetFileVersionInfoSizeW: (file: string, handle: null) => number
  GetFileVersionInfoW: (file: string, handle: number, len: number, data: Buffer) => boolean
  VerQueryValueW: (block: Buffer, sub: string, out: unknown[], len: number[]) => boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  koffi: any
}

let win32: Win32 | null | undefined

const loadWin32 = (): Win32 | null => {
  if (win32 !== undefined) return win32
  win32 = null
  if (process.platform !== 'win32') return win32
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const version = koffi.load('version.dll')
    win32 = {
      koffi,
      GetAsyncKeyState: user32.func('short __stdcall GetAsyncKeyState(int vKey)'),
      keybd_event: user32.func(
        'void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
      ),
      GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func(
        'uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'
      ),
      OpenProcess: kernel32.func(
        'void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'
      ),
      QueryFullProcessImageNameW: kernel32.func(
        'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, _Out_ uint8_t *lpExeName, _Inout_ uint32_t *lpdwSize)'
      ),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *hObject)'),
      GetFileVersionInfoSizeW: version.func(
        'uint32_t __stdcall GetFileVersionInfoSizeW(const char16_t *lptstrFilename, void *lpdwHandle)'
      ),
      GetFileVersionInfoW: version.func(
        'bool __stdcall GetFileVersionInfoW(const char16_t *lptstrFilename, uint32_t dwHandle, uint32_t dwLen, _Out_ uint8_t *lpData)'
      ),
      VerQueryValueW: version.func(
        'bool __stdcall VerQueryValueW(const uint8_t *pBlock, const char16_t *lpSubBlock, _Out_ void **lplpBuffer, _Out_ uint32_t *puLen)'
      )
    }
  } catch (error) {
    log.warn('Win32 helpers unavailable (koffi):', error)
  }
  return win32
}

// ─── Foreground app ─────────────────────────────────────

export type SourceApp = { name: string; icon: string | null }

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

const getExePath = (w: Win32): string | null => {
  const hwnd = w.GetForegroundWindow()
  if (!hwnd) return null
  const pid = [0]
  w.GetWindowThreadProcessId(hwnd, pid)
  if (!pid[0]) return null
  const h = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0])
  if (!h) return null
  try {
    const buf = Buffer.alloc(1024 * 2)
    const size = [1024]
    if (!w.QueryFullProcessImageNameW(h, 0, buf, size)) return null
    return buf.toString('utf16le', 0, size[0] * 2)
  } finally {
    w.CloseHandle(h)
  }
}

// "Microsoft Outlook" rather than "OUTLOOK" when the exe carries version info
const getFileDescription = (w: Win32, exePath: string): string | null => {
  try {
    const len = w.GetFileVersionInfoSizeW(exePath, null)
    if (!len) return null
    const data = Buffer.alloc(len)
    if (!w.GetFileVersionInfoW(exePath, 0, len, data)) return null
    const ptr: unknown[] = [null]
    const n = [0]
    if (!w.VerQueryValueW(data, '\\VarFileInfo\\Translation', ptr, n) || n[0] < 4) return null
    const [lang, cp] = w.koffi.decode(ptr[0], 'uint16_t', 2) as number[]
    const hex = (v: number): string => v.toString(16).padStart(4, '0')
    const sub = `\\StringFileInfo\\${hex(lang)}${hex(cp)}\\FileDescription`
    if (!w.VerQueryValueW(data, sub, ptr, n) || !n[0]) return null
    const desc = String(w.koffi.decode(ptr[0], 'char16_t', n[0])).replace(/\0+$/, '').trim()
    return desc || null
  } catch {
    return null
  }
}

/** The application in the foreground (call before showing Spotlight). */
export const getForegroundApp = async (): Promise<SourceApp | null> => {
  const w = loadWin32()
  if (!w) return null
  try {
    const exePath = getExePath(w)
    if (!exePath) return null
    // Ignore our own windows (e.g. Spotlight triggered from Open WebUI)
    if (path.resolve(exePath) === path.resolve(process.execPath)) return null
    const base = path.basename(exePath).replace(/\.exe$/i, '')
    const name = getFileDescription(w, exePath) || base.charAt(0).toUpperCase() + base.slice(1)
    let icon: string | null = null
    try {
      const img = await app.getFileIcon(exePath, { size: 'normal' })
      icon = img.isEmpty() ? null : img.toDataURL()
    } catch {
      icon = null
    }
    return { name, icon }
  } catch (error) {
    log.warn('getForegroundApp failed:', error)
    return null
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const isKeyDown = (u: Win32, vk: number): boolean => (u.GetAsyncKeyState(vk) & 0x8000) !== 0

// The Spotlight shortcut's modifiers are usually still held when it fires;
// sending Ctrl+C while Alt is down would become Ctrl+Alt+C.
const waitForModifiersReleased = async (u: Win32, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  const mods = [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN]
  while (Date.now() < deadline) {
    if (!mods.some((vk) => isKeyDown(u, vk))) return true
    await sleep(15)
  }
  return false
}

type ClipboardSnapshot = { text: string; html: string; rtf: string; image: Electron.NativeImage }

const snapshotClipboard = (): ClipboardSnapshot => ({
  text: clipboard.readText(),
  html: clipboard.readHTML(),
  rtf: clipboard.readRTF(),
  image: clipboard.readImage()
})

const restoreClipboard = (s: ClipboardSnapshot): void => {
  const data: Electron.Data = {}
  if (s.text) data.text = s.text
  if (s.html) data.html = s.html
  if (s.rtf) data.rtf = s.rtf
  if (!s.image.isEmpty()) data.image = s.image
  if (Object.keys(data).length > 0) clipboard.write(data)
  else clipboard.clear()
}

export const isSelectionCaptureSupported = (): boolean => loadWin32() !== null

/**
 * Returns the text selected in the foreground app, or null when nothing is
 * selected, the platform isn't supported, or the capture failed.
 */
export const captureSelectedText = async (): Promise<string | null> => {
  const u = loadWin32()
  if (!u) return null

  if (!(await waitForModifiersReleased(u, 800))) {
    log.info('Selection capture skipped — modifier keys still held')
    return null
  }

  const snapshot = snapshotClipboard()
  try {
    clipboard.clear()
    u.keybd_event(VK_CONTROL, 0, 0, 0)
    u.keybd_event(VK_C, 0, 0, 0)
    u.keybd_event(VK_C, 0, KEYEVENTF_KEYUP, 0)
    u.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)

    // The target app copies asynchronously; poll briefly
    const deadline = Date.now() + 400
    while (Date.now() < deadline) {
      await sleep(20)
      const text = clipboard.readText()
      if (text) return text.trim() || null
    }
    return null
  } catch (error) {
    log.warn('Selection capture failed:', error)
    return null
  } finally {
    restoreClipboard(snapshot)
  }
}
