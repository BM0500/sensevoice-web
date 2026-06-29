import { useState } from 'react'
import { Copy, Check, AlertCircle, Loader2, CheckCircle2, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import type { FileResult } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ResultsTableProps {
  files: FileResult[]
  emptyHint?: string
}

const STATUS_MAP = {
  pending: { label: '待处理', variant: 'pending' as const, icon: Clock },
  processing: { label: '处理中', variant: 'processing' as const, icon: Loader2 },
  completed: { label: '已完成', variant: 'success' as const, icon: CheckCircle2 },
  failed: { label: '失败', variant: 'destructive' as const, icon: AlertCircle },
}

// 折叠阈值：超过 120 字符就折叠
const COLLAPSE_THRESHOLD = 120

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={copy}
      className="h-7 px-2 text-xs"
      disabled={!text}
    >
      {copied ? (
        <>
          <Check className="mr-1 h-3 w-3" /> 已复制
        </>
      ) : (
        <>
          <Copy className="mr-1 h-3 w-3" /> 复制
        </>
      )}
    </Button>
  )
}

export function ResultsTable({ files, emptyHint = '暂无结果' }: ResultsTableProps) {
  // 记录每个文件是否展开（默认折叠）
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggle = (idx: number) => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  if (files.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {emptyHint}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">识别结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {files.map((f, i) => {
          const cfg = STATUS_MAP[f.status] || STATUS_MAP.pending
          const Icon = cfg.icon
          const isProcessing = f.status === 'processing'
          const isExpanded = expanded.has(i)
          const shouldCollapse =
            f.status === 'completed' && f.text && f.text.length > COLLAPSE_THRESHOLD
          return (
            <div
              key={i}
              className={cn(
                'rounded-lg border bg-card/50 p-3 transition-all',
                isProcessing && 'animate-pulse border-primary/30',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon
                    className={cn(
                      'h-4 w-4 flex-shrink-0',
                      f.status === 'completed' && 'text-success',
                      f.status === 'failed' && 'text-destructive',
                      f.status === 'processing' && 'animate-spin text-primary',
                      f.status === 'pending' && 'text-muted-foreground',
                    )}
                  />
                  <span className="truncate text-sm font-medium" title={f.name}>
                    {f.name}
                  </span>
                  <Badge variant={cfg.variant} className="flex-shrink-0">
                    {cfg.label}
                  </Badge>
                </div>
                {f.status === 'completed' && f.text && <CopyButton text={f.text} />}
              </div>

              {f.status === 'completed' && f.text && (
                <>
                  <p
                    className={cn(
                      'mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm leading-relaxed text-foreground/90',
                      shouldCollapse && !isExpanded && 'line-clamp-4',
                    )}
                  >
                    {f.text}
                  </p>
                  {shouldCollapse && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggle(i)}
                      className="mt-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="mr-1 h-3 w-3" /> 收起
                        </>
                      ) : (
                        <>
                          <ChevronDown className="mr-1 h-3 w-3" /> 展开（{f.text.length} 字）
                        </>
                      )}
                    </Button>
                  )}
                </>
              )}

              {f.status === 'failed' && f.error && (
                <p className="mt-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {f.error}
                </p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
