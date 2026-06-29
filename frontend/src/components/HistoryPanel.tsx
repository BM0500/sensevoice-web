import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, History, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { Card } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { api, type Job } from '@/lib/api'
import { cn, formatDuration } from '@/lib/utils'

const REFRESH_INTERVAL_MS = 5000

interface HistoryPanelProps {
  job: Job | null
  elapsed: number
  onLoad: (jobId: string) => void
}

export function HistoryPanel({ job, elapsed, onLoad }: HistoryPanelProps) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const inFlight = useRef(false)

  const fetchHistory = useCallback(async (silent = false) => {
    if (inFlight.current) return
    inFlight.current = true
    if (!silent) setLoading(true)
    try {
      const res = await api.listJobs(50)
      setHistory(res.jobs)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载历史失败')
    } finally {
      inFlight.current = false
      if (!silent) setLoading(false)
    }
  }, [])

  // 首次挂载 + 打开面板时拉取
  useEffect(() => {
    fetchHistory(true)
  }, [fetchHistory])

  useEffect(() => {
    if (open) fetchHistory(true)
  }, [open, fetchHistory])

  // 当前任务进入终态时刷新一次
  useEffect(() => {
    if (job && (job.status === 'completed' || job.status === 'failed')) {
      fetchHistory(true)
    }
  }, [job?.id, job?.status, fetchHistory])

  // 打开面板后定期刷新
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => fetchHistory(true), REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [open, fetchHistory])

  // 前端搜索：按文件名模糊匹配（不区分大小写）
  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return history
    return history.filter((h) =>
      h.files.some((f) => f.name.toLowerCase().includes(q)),
    )
  }, [history, query])

  const clearAll = async () => {
    if (!confirm(`清空全部 ${history.length} 条历史记录？`)) return
    setError(null)
    const targets = history.map((h) => h.id)
    setHistory([])
    const failed: string[] = []
    for (const id of targets) {
      try {
        await api.deleteJob(id)
      } catch {
        failed.push(id)
      }
    }
    if (failed.length) {
      setError(`有 ${failed.length} 条删除失败，请刷新`)
      fetchHistory(true)
    }
  }

  const removeOne = async (id: string) => {
    if (!confirm('删除这条历史记录？')) return
    setError(null)
    setPendingDelete(id)
    // 乐观更新
    const prev = history
    setHistory((cur) => cur.filter((h) => h.id !== id))
    try {
      await api.deleteJob(id)
    } catch (e) {
      // 回滚
      setHistory(prev)
      setError(e instanceof Error ? e.message : '删除失败')
    } finally {
      setPendingDelete((cur) => (cur === id ? null : cur))
    }
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">历史记录</span>
          <Badge variant="secondary" className="text-xs">
            {history.length}
          </Badge>
          {job && (job.status === 'completed' || job.status === 'failed') && (
            <Badge variant="outline" className="text-xs">
              本次用时 {formatDuration(elapsed)}
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="border-t p-4">
          {error && (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading ? '加载中…' : '暂无历史记录'}
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                {/* 搜索框 */}
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="按文件名搜索…"
                    className="w-full rounded-md border border-input bg-background/60 py-1.5 pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label="清空搜索"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => fetchHistory()} disabled={loading}>
                  <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
                  刷新
                </Button>
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  清空
                </Button>
              </div>
              {filteredHistory.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  没有匹配 “{query}” 的记录
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-muted-foreground">
                    显示 {filteredHistory.length} / {history.length} 条
                    {query && `（已过滤）`}
                  </p>
                  <ul className="space-y-2">
                    {filteredHistory.map((h) => {
                  const completed = h.files.filter((f) => f.status === 'completed').length
                  const failedCount = h.files.filter((f) => f.status === 'failed').length
                  const updatedAt = h.updated_at ?? Date.now() / 1000
                  const createdAt = h.created_at ?? updatedAt
                  const time = new Date(updatedAt * 1000).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  const totalDuration = updatedAt - createdAt
                  const isCurrent = job?.id === h.id
                  return (
                    <li
                      key={h.id}
                      className={cn(
                        'group rounded-lg border bg-card/50 p-3 text-sm transition-colors hover:bg-muted/50',
                        isCurrent && 'border-primary/50 bg-primary/5',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {time} · {completed}/{h.total} 完成
                            {failedCount > 0 && (
                              <span className="ml-1 text-xs text-destructive">
                                · {failedCount} 失败
                              </span>
                            )}
                            {totalDuration > 0 && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                用时 {formatDuration(totalDuration)}
                              </span>
                            )}
                            {isCurrent && (
                              <Badge variant="default" className="ml-2 text-xs">
                                当前
                              </Badge>
                            )}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {h.files.map((f) => f.name).join(', ')}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onLoad(h.id)}
                            title="加载到主界面"
                          >
                            加载
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(api.getExportUrl(h.id), '_blank')}
                          >
                            导出
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeOne(h.id)}
                            disabled={pendingDelete === h.id}
                            className="text-destructive hover:text-destructive"
                          >
                            {pendingDelete === h.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}