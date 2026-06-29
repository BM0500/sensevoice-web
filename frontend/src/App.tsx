import { useCallback, useEffect, useRef, useState } from 'react'
import { Header } from './components/Header'
import { DropZone } from './components/DropZone'
import { StatusBar } from './components/StatusBar'
import { ResultsTable } from './components/ResultsTable'
import { HistoryPanel } from './components/HistoryPanel'
import { ThemeProvider } from './components/ThemeProvider'
import { api, type Job, type LanguageCode } from './lib/api'

const POLL_INTERVAL_MS = 1000
const TIMER_TICK_MS = 200
const MAX_UPLOAD_MB = 500

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}

function AppContent() {
  const [files, setFiles] = useState<File[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  // 语种选择：默认 auto，遇到气声/背景噪音可切到 "zh" 强制
  const [language, setLanguage] = useState<LanguageCode>('auto')
  const isProcessing = job?.status === 'processing' || job?.status === 'queued'

  // 同步 onStart 到 ref：避免键盘 handler 闭包陷阱
  const onStartRef = useRef<() => void>(() => {})

  // 启动计时器：进入 processing 时打点
  useEffect(() => {
    if (job?.status === 'processing' && startTime === null) {
      setStartTime(Date.now())
      setElapsed(0)
    }
  }, [job?.status, startTime])

  // 计时器心跳：仅在任务活跃时更新
  useEffect(() => {
    if (startTime === null || !job) return
    const isActive = job.status === 'processing' || job.status === 'queued'
    if (!isActive) return
    const id = setInterval(() => {
      setElapsed((Date.now() - startTime) / 1000)
    }, TIMER_TICK_MS)
    return () => clearInterval(id)
  }, [startTime, job])

  // 轮询任务状态
  useEffect(() => {
    if (!job) return
    if (job.status === 'completed' || job.status === 'failed') return
    let cancelled = false
    const tick = async () => {
      try {
        const updated = await api.getJob(job.id)
        if (!cancelled) setJob(updated)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '任务已过期或丢失')
          setJob(null)
        }
      }
    }
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [job?.id, job?.status])

  // 全局快捷键：Ctrl/Cmd+Enter 触发开始识别，Esc 清空文件/错误
  // 注意：输入框聚焦时不抢焦
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (isInput) return

      // Ctrl/Cmd + Enter：开始识别（仅在有文件、未处理中时可触发）
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (files.length > 0 && !isUploading && !isProcessing) {
          void onStartRef.current()
        }
      }
      // Esc：清空文件（不打断进行中的任务）
      else if (e.key === 'Escape') {
        if (files.length > 0 || error) {
          setFiles([])
          setError(null)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [files.length, isUploading, isProcessing, error])

  const onStart = useCallback(async () => {
    if (files.length === 0) return
    setError(null)
    setIsUploading(true)
    try {
      const created = await api.createJob(files, language)
      const initialJob: Job = {
        id: created.job_id,
        total: created.total,
        done: 0,
        status: 'queued',
        language: created.language,
        files: created.files.map((f) => ({
          name: f.name,
          status: f.status,
          text: '',
          error: '',
        })),
        error: '',
      }
      setJob(initialJob)
      setFiles([])
      setElapsed(0)
      setStartTime(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setIsUploading(false)
    }
  }, [files, language])

  // 保持 ref 指向最新的 onStart，让全局快捷键 handler 能调到
  useEffect(() => {
    onStartRef.current = onStart
  }, [onStart])

  const onClear = useCallback(() => {
    setFiles([])
    setJob(null)
    setError(null)
    setElapsed(0)
    setStartTime(null)
  }, [])

  const onLoad = useCallback(async (jobId: string) => {
    setError(null)
    try {
      const loaded = await api.getJob(jobId)
      setJob(loaded)
      setElapsed(0)
      setStartTime(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载任务失败')
    }
  }, [])

  return (
    <div className="app-bg min-h-screen">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <Header language={language} onLanguageChange={setLanguage} />
        <DropZone
          files={files}
          onFilesChange={setFiles}
          disabled={isUploading || isProcessing}
          maxSizeMB={MAX_UPLOAD_MB}
        />
        <StatusBar
          job={job}
          error={error}
          hasFiles={files.length > 0}
          isUploading={isUploading}
          elapsed={elapsed}
          onStart={onStart}
          onClear={onClear}
        />
        {job && <ResultsTable files={job.files} />}
        <HistoryPanel job={job} elapsed={elapsed} onLoad={onLoad} />
        <footer className="space-y-1 pt-2 text-center text-xs text-muted-foreground">
          <p>SenseVoice · 基于 FunASR · 单文件最大 {MAX_UPLOAD_MB}MB</p>
          <p className="text-muted-foreground/70">
            快捷键：<kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Ctrl/⌘+Enter</kbd> 开始识别 · <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> 清空
          </p>
        </footer>
      </div>
    </div>
  )
}