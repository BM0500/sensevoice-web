# AI Agent 接入指南

> 本项目提供 **OpenAI 兼容的 `/v1/audio/transcriptions` 端点**，
> 任何支持 OpenAI SDK 的 AI agent / 工具 / 服务都能直接调用，无需适配代码。

---

## 📋 目录

- [5 秒接入](#5-秒接入)
- [端点规范](#端点规范)
- [4 种 response_format](#4-种-response_format)
- [编程示例](#编程示例)
- [多语言支持](#多语言支持)
- [常见问题](#常见问题)
- [进阶：MCP 集成](#进阶mcp-集成)

---

## 5 秒接入

把 OpenAI SDK 的 `base_url` 指向本服务即可，**api_key 随便填**（本项目无鉴权）：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://nas.local:18080/v1",  # ← 唯一改动
    api_key="not-needed",                   # ← 随便填，本服务不校验
)

with open("audio.mp3", "rb") as f:
    result = client.audio.transcriptions.create(
        model="sensevoice",
        file=f,
        language="zh",      # 可选：auto / zh / en / yue / ja / ko
    )

print(result.text)
```

其他所有 LangChain / AutoGen / CrewAI / OpenAI Agents SDK 等框架同理，只需改 `base_url`。

---

## 端点规范

| 项目 | 值 |
|---|---|
| **URL** | `POST /v1/audio/transcriptions` |
| **Content-Type** | `multipart/form-data` |
| **同步 / 异步** | 同步（阻塞到识别完成） |
| **超时** | 客户端自定（建议 ≥ 5 分钟） |
| **认证** | 无（NAS 个人自用，假设 LAN 可信） |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | file | ✅ | 音频或视频文件（wav/mp3/m4a/ogg/flac/wma；mp4/mov/avi/mkv/webm） |
| `model` | string | ❌ | 固定传 `"sensevoice"`（OpenAI 兼容要求字段） |
| `language` | string | ❌ | `auto`(默认) / `zh` / `en` / `yue` / `ja` / `ko` / `nospeech` |
| `response_format` | string | ❌ | `json`(默认) / `text` / `srt` / `vtt` |

### 与 OpenAI 的差异

| OpenAI 字段 | 本项目状态 | 说明 |
|---|---|---|
| `model` | 固定 `"sensevoice"` | 不支持切换，仅 SenseVoiceSmall |
| `temperature` | ❌ 不支持 | ASR 不采样 |
| `timestamp_granularities` | ❌ 不支持 | 见下方 SRT/VTT 限制 |
| `prompt` | ❌ 不支持 | 没有 hotword 功能 |
| 鉴权 | ❌ 无 | 任何 LAN 设备可调 |

---

## 4 种 response_format

### json（默认，OpenAI 标准）

```bash
curl -X POST http://nas.local:18080/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "language=zh"
```

```json
{"text": "识别出的文本内容"}
```

### text（纯文本）

```bash
curl -X POST http://nas.local:18080/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "response_format=text"
```

```
识别出的文本内容
```

### srt（字幕格式）

```bash
curl -X POST http://nas.local:18080/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "response_format=srt" -o out.srt
```

```
1
00:00:00,000 --> 00:59:59,999
识别出的文本内容
```

### vtt（WebVTT 字幕）

```bash
curl -X POST http://nas.local:18080/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "response_format=vtt" -o out.vtt
```

```
WEBVTT

00:00:00.000 --> 00:59:59.999
识别出的文本内容
```

> ⚠️ **SRT/VTT 限制**：当前版本 SenseVoice 不返回逐句时间戳，SRT/VTT 输出为**单段**（整段视为一句）。需要逐句时间戳请用前端 UI 异步接口 `/api/transcribe` + 后处理，或后续升级 funasr `return_timestamp=True`。

---

## 编程示例

### Python（OpenAI SDK，最常用）

```python
from openai import OpenAI

client = OpenAI(base_url="http://nas.local:18080/v1", api_key="not-needed")

# 基本
with open("audio.mp3", "rb") as f:
    result = client.audio.transcriptions.create(model="sensevoice", file=f)
print(result.text)

# 强制中文（推荐：避免气声被误识别为日语）
with open("audio.mp3", "rb") as f:
    result = client.audio.transcriptions.create(
        model="sensevoice",
        file=f,
        language="zh",
    )
print(result.text)

# 字幕文件
with open("audio.mp3", "rb") as f:
    result = client.audio.transcriptions.create(
        model="sensevoice",
        file=f,
        response_format="srt",
    )
with open("out.srt", "w") as out:
    out.write(result)
```

### Python（requests 直接调）

```python
import requests

with open("audio.mp3", "rb") as f:
    r = requests.post(
        "http://nas.local:18080/v1/audio/transcriptions",
        files={"file": f},
        data={"language": "zh", "response_format": "json"},
        timeout=300,
    )

r.raise_for_status()
text = r.json()["text"]
```

### JavaScript / TypeScript（fetch）

```typescript
async function transcribe(file: File, language = 'auto') {
  const form = new FormData()
  form.append('file', file)
  form.append('language', language)
  form.append('model', 'sensevoice')

  const res = await fetch('http://nas.local:18080/v1/audio/transcriptions', {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(await res.text())
  const { text } = await res.json()
  return text
}
```

### cURL（命令行调试）

```bash
curl -X POST http://nas.local:18080/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "language=zh"
```

### LangChain

```python
from langchain_community.document_loaders.blob_loaders import Blob
# LangChain 没有内置 ASR Loader，但可以用 OpenAI SDK 包装
from openai import OpenAI

client = OpenAI(base_url="http://nas.local:18080/v1", api_key="not-needed")
def transcribe_for_langchain(blob: Blob) -> str:
    with blob.as_bytes_io() as f:
        return client.audio.transcriptions.create(model="sensevoice", file=f).text
```

---

## 多语言支持

| language | 用途 |
|---|---|
| `auto`（默认） | SenseVoice 自动检测 LID；适合中英混合 |
| `zh` | 中文普通话 — **推荐**：避免气声误识别 |
| `en` | 英语 |
| `yue` | 粤语 |
| `ja` | 日语 |
| `ko` | 韩语 |
| `nospeech` | 强制声明为非语音 |

**经验法则**：
- 内容明确时（会议、播客）→ 显式指定 language
- 内容混杂时 → 用 auto 让模型切语种
- 背景噪音/气声多 → 显式指定 language，否则可能被识别成日语

---

## 常见问题

### Q1: 客户端 timeout 怎么办？

长音频（1 小时讲座）单飞 + INT8 推理在 N100 上需要 1-5 分钟。客户端 timeout 设到 600 秒：

```python
r = requests.post(..., timeout=600)  # 10 分钟
```

如果单条太长，建议先在前端用 ffmpeg 切片（每段 ≤ 10 分钟）。

### Q2: 单飞阻塞怎么办？

`SINGLE_FLIGHT=true` 时，第二个请求会**阻塞等待**第一个完成。
N100 个人用场景下，单飞更稳。如果想并发，.env 里改：

```bash
SINGLE_FLIGHT=false
```

但需要同步降低 `INTRA_OP_THREADS`（如改 2）。

### Q3: 响应慢在哪？

模型推理本身只占 30-50% 时间，剩下是：
- ffmpeg 抽音轨（视频）
- 文件 IO
- 网络传输

优化建议：
- 用本地 SSD 存模型和临时文件
- 客户端压缩（mp3/aac 比 wav 小 10 倍）

### Q4: 如何鉴权？

当前**无鉴权**，假设 NAS 在家庭 LAN 内部。
如果需要鉴权，建议在前面套 **Caddy 反向代理 + Basic Auth**：

```caddyfile
nas.local:18080 {
    basicauth {
        admin $2a$14$...  # bcrypt hash
    }
    reverse_proxy localhost:8000
}
```

### Q5: 怎么限流？

同样在反代层做，例如 Caddy 加 `rate_limit`：

```caddyfile
rate_limit {remote.ip} 10r/m  # 每 IP 每分钟 10 次
```

### Q6: 服务返回 500 / "缺少必需文件" 错误？

**原因**：NAS 上的模型目录不完整（下载中断、人工删除部分文件、磁盘故障等）。本项目新版 `_resolve_model()` 会主动校验文件完整性并打印修复命令。
**日志示例**：
```
ASR 模型：本地目录 /app/models/sensevoice 缺少必需文件 ['model.pt']。
建议修复：rm -rf /app/models/sensevoice && python scripts/download_model.py --model asr
```
**修复**：SSH 到 NAS 跑日志里给的命令，或者：

```bash
ssh sun@nas.local "cd /mnt/dockervol/sensevoice-web && \
    rm -rf data/models/sensevoice && \
    docker compose run --rm sensevoice python scripts/download_model.py --model sensevoice && \
    docker compose restart sensevoice"
```

详见 [deploy-dxp4800.md](deploy-dxp4800.md) 的 FAQ 部分。

---

## 进阶：MCP 集成

如果你想让 **Claude Desktop / Cursor / Cline** 把识别当原生工具用，需要装个 MCP server 桥接（`/v1/audio/transcriptions`）。

最小实现（60 行）：

```python
# mcp_server.py
from mcp.server import Server
from mcp.types import Tool
from openai import OpenAI
import mcp.server.stdio

server = Server("sensevoice")
client = OpenAI(base_url="http://localhost:8000/v1", api_key="x")

@server.list_tools()
async def list_tools():
    return [Tool(
        name="transcribe_audio",
        description="把音频/视频文件转成文本",
        inputSchema={
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "language": {"type": "string", "enum": ["auto","zh","en","yue","ja","ko"]},
            },
            "required": ["file_path"],
        },
    )]

@server.call_tool()
async def call_tool(name, args):
    with open(args["file_path"], "rb") as f:
        text = client.audio.transcriptions.create(
            model="sensevoice", file=f, language=args.get("language", "auto")
        ).text
    return [{"type": "text", "text": text}]

if __name__ == "__main__":
    mcp.server.stdio.run(server)
```

Claude Desktop 配置：

```json
{
  "mcpServers": {
    "sensevoice": {
      "command": "python",
      "args": ["/path/to/mcp_server.py"]
    }
  }
}
```

然后 Claude 就能直接说："把 `/Users/me/voice.mp3` 转成文本"。

---

## 🔗 相关文档

- [deploy-dxp4800.md](deploy-dxp4800.md) — DXP4800 部署手册
- [Swagger UI](http://nas.local:18080/docs) — 自动生成的 API 文档
- [OpenAI Audio API 官方文档](https://platform.openai.com/docs/api-reference/audio/createTranscription) — 参考规范