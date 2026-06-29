import { Download, Trash2, Play, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import type { Job } from '@/lib/api'
import { api } from '@/lib/api'
import { cn, formatDuration } from '@/lib/utils'

interface StatusBarProps {
  job: Job | null
  error: string | null
  hasFiles: boolean
  isUploading: boolean
  elapsed: number
  onStart: () => void
  onClear: () => void
}

const STATUS_TEXT = {
  queued: '排队中...',
  processing: '正在识别',
  completed: '全部完成',
  failed: '识别失败',
}

export function StatusBar({
  job,
  error,
  hasFiles,
  isUploading,
  elapsed,
  onStart,
  onClear,
}: StatusBarProps) {
  const progress = job ? Math.round((job.done / Math.max(job.total, 1)) * 100) : 0
  const isProcessing = job?.status === 'processing' || job?.status === 'queued'
  const canStart = hasFiles && !isProcessing && !isUploading
  const canExport = job?.status === 'completed' && job.files.some((f) => f.text)
  // 当前正在处理的文件名（取第一个 processing 状态的文件）
  const currentFile = job?.files.find((f) => f.status === 'processing')?.name

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {error ? (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          ) : job ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {STATUS_TEXT[job.status]} · {job.done}/{job.total}
                </span>
                {isProcessing && (
                  <span className="text-xs text-muted-foreground">
                    已用时 {formatDuration(elapsed)}
                  </span>
                )}
              </div>
              {/* 当前正在处理的文件名（处理中且未完成时显示） */}
              {currentFile && job.status === 'processing' && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span className="truncate" title={currentFile}>
                    正在识别：<span className="text-foreground/80">{currentFile}</span>
                  </span>
                </div>
              )}
              <Progress
                value={progress}
                className={cn(isProcessing && 'animate-pulse')}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {hasFiles ? '准备就绪，点击「开始识别」启动' : '请选择音频或视频文件'}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 gap-2">
          {canExport && job && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(api.getExportUrl(job.id), '_blank')}
            >
              <Download className="mr-1.5 h-4 w-4" />
              导出 TXT
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={isProcessing || isUploading}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            清除
          </Button>
          <Button
            variant="gradient"
            size="sm"
            onClick={onStart}
            disabled={!canStart}
          >
            <Play className="mr-1.5 h-4 w-4" />
            {isUploading ? '上传中...' : '开始识别'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
