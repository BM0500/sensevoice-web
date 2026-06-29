import { useEffect, useRef, useState } from 'react'
import { Pause, Play, X, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { cn, formatBytes, formatDuration } from '@/lib/utils'

interface WaveformPreviewProps {
  file: File
  onRemove: () => void
  disabled?: boolean
}

// 波形条数（越多越精细，但渲染开销越大；200 条对 1GB 文件都丝滑）
const PEAK_COUNT = 160

/**
 * 单文件预览行：
 *  - 音频：解码 → Canvas 绘制波形 + 播放按钮 + 时长
 *  - 视频：原生 <video> 元素 + 时长（不解码波形，太重）
 */
export function WaveformPreview({ file, onRemove, disabled }: WaveformPreviewProps) {
  const isVideo = file.type.startsWith('video/')
  const isAudio = file.type.startsWith('audio/') || (!isVideo && file.name.match(/\.(wav|mp3|m4a|ogg|flac|wma)$/i))

  if (isVideo) {
    return <VideoRow file={file} onRemove={onRemove} disabled={disabled} />
  }
  if (isAudio) {
    return <AudioRow file={file} onRemove={onRemove} disabled={disabled} />
  }
  // 兜底：未知类型（基本不会触发，保底用）
  return <GenericRow file={file} onRemove={onRemove} disabled={disabled} />
}

// ────────────────────────── 音频行：波形 + 播放 ──────────────────────────
function AudioRow({ file, onRemove, disabled }: WaveformPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [decoding, setDecoding] = useState(true)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [url, setUrl] = useState<string>('')

  // 创建 ObjectURL + 解码
  useEffect(() => {
    const objUrl = URL.createObjectURL(file)
    setUrl(objUrl)
    setDecoding(true)
    setDecodeError(null)

    let cancelled = false
    const ctx = new AudioContext()
    file
      .arrayBuffer()
      .then((buf) => ctx.decodeAudioData(buf.slice(0)))
      .then((decoded) => {
        if (cancelled) return
        setDuration(decoded.duration)
        // 取峰值：把音频分成 N 段，每段取最大绝对值
        const data = decoded.getChannelData(0)
        const samplesPerBin = Math.max(1, Math.floor(data.length / PEAK_COUNT))
        const out = new Float32Array(PEAK_COUNT)
        for (let i = 0; i < PEAK_COUNT; i++) {
          let max = 0
          const start = i * samplesPerBin
          const end = Math.min(start + samplesPerBin, data.length)
          for (let j = start; j < end; j++) {
            const v = Math.abs(data[j])
            if (v > max) max = v
          }
          out[i] = max
        }
        setPeaks(out)
        setDecoding(false)
      })
      .catch((e) => {
        if (cancelled) return
        setDecodeError(e instanceof Error ? e.message : '解码失败')
        setDecoding(false)
      })
      .finally(() => {
        ctx.close().catch(() => {})
      })

    return () => {
      cancelled = true
      URL.revokeObjectURL(objUrl)
    }
  }, [file])

  // 绘制波形（peaks 变化时重绘）
  useEffect(() => {
    if (!peaks || !canvasRef.current) return
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    canvas.width = cssWidth * dpr
    canvas.height = cssHeight * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    const gap = 1
    const barWidth = Math.max(1, (cssWidth - gap * (PEAK_COUNT - 1)) / PEAK_COUNT)
    const mid = cssHeight / 2
    // 用 CSS 变量取色（HMR + 主题切换都能跟上）
    const primary = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary')
      .trim()
    const muted = getComputedStyle(document.documentElement)
      .getPropertyValue('--muted-foreground')
      .trim()

    // 计算播放进度（按 currentTime/duration 比例）
    const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0

    for (let i = 0; i < PEAK_COUNT; i++) {
      const h = Math.max(2, peaks[i] * cssHeight * 0.85)
      const x = i * (barWidth + gap)
      const y = mid - h / 2
      const played = i / PEAK_COUNT < progressRatio
      ctx.fillStyle = played ? `hsl(${primary})` : `hsl(${muted} / 0.5)`
      ctx.fillRect(x, y, barWidth, h)
    }
  }, [peaks, currentTime, duration])

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      void el.play()
    }
  }

  return (
    <li
      className={cn(
        'group rounded-lg border bg-background/60 px-3 py-2.5 text-sm transition-colors',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        {/* 播放/暂停按钮 */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
          onClick={togglePlay}
          disabled={decoding || !!decodeError}
          aria-label={playing ? '暂停' : '播放'}
        >
          {decoding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>

        {/* 文件名 + 时长 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium" title={file.name}>
              {file.name}
            </span>
            <span className="flex-shrink-0 text-xs text-muted-foreground">
              {duration > 0 ? formatDuration(duration) : '--'}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatBytes(file.size)}</span>
            {decodeError && <span className="text-destructive">⚠ {decodeError}</span>}
          </div>
        </div>

        {/* 移除按钮 */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          disabled={disabled}
          aria-label="移除"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 波形条 */}
      <div className="mt-2 h-10">
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ display: 'block' }}
        />
      </div>

      {/* 隐藏 audio 元素，仅作播放源 */}
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        className="hidden"
      />
    </li>
  )
}

// ────────────────────────── 视频行：原生 <video> ──────────────────────────
function VideoRow({ file, onRemove, disabled }: WaveformPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(0)
  const [url, setUrl] = useState<string>('')

  useEffect(() => {
    const objUrl = URL.createObjectURL(file)
    setUrl(objUrl)
    return () => URL.revokeObjectURL(objUrl)
  }, [file])

  return (
    <li
      className={cn(
        'group rounded-lg border bg-background/60 px-3 py-2.5 text-sm transition-colors',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium" title={file.name}>
              {file.name}
            </span>
            <span className="flex-shrink-0 text-xs text-muted-foreground">
              {duration > 0 ? formatDuration(duration) : '--'}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatBytes(file.size)} · 视频
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          disabled={disabled}
          aria-label="移除"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <video
        ref={videoRef}
        src={url}
        controls
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        className="mt-2 max-h-48 w-full rounded-md bg-black"
      />
    </li>
  )
}

// ────────────────────────── 兜底：未知格式 ──────────────────────────
function GenericRow({ file, onRemove, disabled }: WaveformPreviewProps) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-md bg-background/60 px-3 py-2 text-sm',
        disabled && 'opacity-60',
      )}
    >
      <span className="flex-1 truncate" title={file.name}>
        {file.name}
      </span>
      <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        disabled={disabled}
        aria-label="移除"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}