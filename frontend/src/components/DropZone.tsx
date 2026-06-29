import { useCallback, useRef, useState, type DragEvent } from 'react'
import { UploadCloud, Music, Film } from 'lucide-react'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { formatBytes } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { WaveformPreview } from './WaveformPreview'

interface DropZoneProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  disabled?: boolean
  accept?: string
  maxSizeMB?: number
}

export function DropZone({
  files,
  onFilesChange,
  disabled,
  accept = 'audio/*,video/*,.wav,.mp3,.m4a,.ogg,.flac,.wma,.mp4,.mov,.avi,.mkv,.webm',
  maxSizeMB = 500,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validateAndAdd = useCallback(
    (incoming: File[]) => {
      setError(null)
      const valid: File[] = []
      for (const f of incoming) {
        if (f.size > maxSizeMB * 1024 * 1024) {
          setError(`"${f.name}" 超过 ${maxSizeMB}MB 限制`)
          continue
        }
        valid.push(f)
      }
      if (valid.length > 0) {
        onFilesChange([...files, ...valid])
      }
    },
    [files, onFilesChange, maxSizeMB],
  )

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length) validateAndAdd(dropped)
  }

  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (selected.length) validateAndAdd(selected)
    e.target.value = '' // 允许重复选择同名文件
  }

  const removeFile = (idx: number) => {
    onFilesChange(files.filter((_, i) => i !== idx))
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const audioCount = files.filter((f) => f.type.startsWith('audio/')).length
  const videoCount = files.filter((f) => f.type.startsWith('video/')).length

  return (
    <Card className="overflow-hidden">
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        className={cn(
          'relative p-8 text-center transition-all',
          dragOver && 'bg-primary/5 ring-2 ring-primary ring-inset',
          disabled && 'opacity-50',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          onChange={onSelect}
          className="hidden"
          disabled={disabled}
        />

        <div className="mx-auto flex max-w-md flex-col items-center gap-3">
          <div
            className={cn(
              'rounded-full p-4 transition-colors',
              dragOver ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            <UploadCloud className="h-8 w-8" />
          </div>
          <div>
            <p className="text-base font-medium">拖拽文件到此处</p>
            <p className="mt-1 text-sm text-muted-foreground">
              或{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-medium text-primary hover:underline"
                disabled={disabled}
              >
                点击选择
              </button>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            音频: wav / mp3 / m4a / ogg / flac / wma · 视频: mp4 / mov / avi / mkv / webm
          </p>
          <p className="text-xs text-muted-foreground">单文件最大 {maxSizeMB}MB</p>
        </div>

        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}
      </div>

      {files.length > 0 && (
        <div className="border-t bg-muted/30 px-4 py-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">
                已选 {files.length} 个 · {formatBytes(totalSize)}
              </span>
              {audioCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Music className="h-3 w-3" /> {audioCount}
                </span>
              )}
              {videoCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Film className="h-3 w-3" /> {videoCount}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onFilesChange([])} disabled={disabled}>
              清空
            </Button>
          </div>
          {/* 高度比旧版大，给波形 / 视频控件留空间 */}
          <ul className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {files.map((f, i) => (
              <WaveformPreview
                key={`${f.name}-${i}`}
                file={f}
                onRemove={() => removeFile(i)}
                disabled={disabled}
              />
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
