# easymem

[English](./README.md) · 简体中文

给你的代码库配一个本地 wiki，以 **MCP server** 的形式提供。不要 API key，不上云，不用第二个模型。

页面由你本来就在用的编码 agent 来写 —— Claude Code、Codex、opencode。
easymem 负责存下来、建索引、连成图。

## 为什么

大部分「知识库」工具都要你再给它一个模型 key。这意味着第二份账单、第二份配置文件，
以及一个往往比提问的那个 agent 还弱的模型。

easymem 里面没有模型。**MCP 管道另一端的 agent 就是模型。** 它读你的文件，
判断一个页面该写什么，然后调用 `wiki_write`。easymem 只做模型不擅长的那些事：
全文搜索、链接图，以及记住上次之后哪些源文件变了。

它也没有 native 模块 —— 三个纯 JavaScript 依赖，没有任何东西需要编译。
`npx` 要么直接跑起来，要么就是你的网断了。

## 安装

在 agent 的 MCP 配置里加一段就行，没有别的要设置的。

**Claude Code** —— 项目根目录的 `.mcp.json`：

```json
{
  "mcpServers": {
    "easymem": { "command": "npx", "args": ["-y", "easymem"] }
  }
}
```

**Codex** —— `~/.codex/config.toml`：

```toml
[mcp_servers.easymem]
command = "npx"
args = ["-y", "easymem"]
```

**opencode** —— `opencode.json`：

```json
{
  "mcp": {
    "easymem": { "type": "local", "command": ["npx", "-y", "easymem"], "enabled": true }
  }
}
```

页面会落在代码旁边的 `.easymem/wiki/`。想换个地方就用 `--dir <path>` 或 `EASYMEM_DIR`。

## 用法

直接问，agent 会自己挑工具：

> 把 `docs/` 下面的内容都读一遍，建一个 wiki。

> 关于结算流程，我们已经知道些什么？

第一次跑会走一遍文件、写页面。之后只碰变过的 —— easymem 给每个源文件算了哈希，
没变的文件不花任何成本。

## 工具

| 工具 | 做什么 |
| --- | --- |
| `wiki_search` | 全文搜索，然后顺着 `[[链接]]` 走一层，相关页面也会一起浮出来 |
| `wiki_read` | 读一个页面 |
| `wiki_list` | 列出所有页面：id、标题、类型、路径 |
| `wiki_graph` | 整张链接图 —— 找出枢纽页和孤儿页 |
| `wiki_guide` | 写作规则，运行时直接交给 agent |
| `wiki_pending` | 上次之后哪些源文件是新的或改过的 |
| `wiki_write` | 写一个页面 |
| `wiki_delete` | 删一个页面 |
| `wiki_reindex` | 重建索引、链接图和 `index.md` |

`wiki_guide` 是这个 wiki 在每个客户端里都长成同一个形状的原因：写作规则跟着
工具返回值走，而不是放在一个每个工具叫法都不同的配置文件里。包里确实带了一个
`SKILL.md`，但它是故意写薄的 —— 它只说**什么时候**该想到 wiki，**怎么写**原样
交还给 `wiki_guide`。

## 磁盘上有什么

```
.easymem/
├── wiki/                     markdown 页面 —— 这些要提交进 git
│   ├── index.md              每次 reindex 重新生成
│   ├── entities/             一个具体的东西：服务、表、角色
│   ├── concepts/             跨越多个东西的概念：流程、策略
│   ├── sources/              每份源文档一个页面
│   ├── comparisons/          X 和 Y 的对比
│   └── synthesis/            从多个页面得出的结论
└── .state/
    ├── sources.json          哪些源文件已经处理过，按内容哈希记
    └── wiki-sources.json     扫描状态记账
```

就这些，没有数据库。

搜索索引和链接图是服务器启动时从 markdown 在内存里现建的，`wiki_reindex` 时重建。
什么都不缓存，因为不需要：页面**就是**唯一的真相来源，1000 个页面重建大约 120 ms，
5000 个 230 ms，查询是个位数毫秒。

`wiki/` 之外没有任何东西是真相来源。`.state/` 里存的是让 `wiki_pending` 能跳过
已完成文件的内容哈希 —— 这是唯一一个没办法从页面本身推导出来的事实 —— 外加一点
扫描记账。把 `.state/` 删掉，下次运行会把所有源文件重读一遍，除了时间什么都不会丢。

页面是带 YAML frontmatter 的纯 markdown。不存在任何锁定 —— 把 easymem 删掉，
你手里剩下的还是一个能直接读的笔记文件夹。

加到 `.gitignore`：

```
.easymem/.state/
```

## 开发

```bash
pnpm install
pnpm dev            # 直接从 src 跑 MCP server，走 stdio
pnpm lint
pnpm test           # jest 单元测试，带覆盖率
pnpm build          # tsc → dist/，dist/cli.js 就是发布的可执行文件
pnpm ci             # build + typecheck + test，和 CI 跑的完全一样
```

需要 Node 20 或更高版本。

## 这东西是怎么来的

想法来自 Andrej Karpathy 的
[LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)：
别每次提问都对原始资料重跑一遍 RAG，让 agent 把读到的东西**编译**成一个由
markdown 页面组成的 wiki，之后从 wiki 里回答。

我在自己的知识库 `brain` 里用这个模式用了很久。它确实有效，但效果不算好。
只靠一段提示词描述任务，agent 每天写出来的页面都是不同的形状 ——
而一个每页长得都不一样的 wiki，是一堆散沙，不是 wiki。

后来看到
[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)。
它其实就是同一个 LLM wiki 的变种，但外面套了真正的约束：固定的页面格式、
真的分词器、链接图。加上这些约束之后，效果确实好了不少。

它也确实很重 —— LLM 客户端、HTTP API、控制台、多租户存储、SQLite 索引。
但有时候我们只是想要一个轻量的 wiki，帮一下手上已经有的那个 agent。
所以 easymem 把里面的 `MemoryKnowledge` 引擎抽了出来 —— 中英混合分词器、
多跳图搜索、页面格式 —— 放到一个 MCP 接口后面。没有别的东西。

MIT。TencentDB-Agent-Memory 也是 MIT。
