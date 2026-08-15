<div align="center">

# easymem

一个由你的编码 agent 自己写的 LLM wiki —— 打得开、读得懂的 agent 记忆。

[English](README.md) · [简体中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/easymem.svg)](https://www.npmjs.com/package/easymem)
[![downloads](https://img.shields.io/npm/dm/easymem.svg)](https://www.npmjs.com/package/easymem)
[![license](https://img.shields.io/npm/l/easymem.svg)](https://github.com/zhangxiangliang/easymem/blob/main/LICENSE)
[![typescript](https://img.shields.io/badge/language-typescript-blue.svg)](https://www.typescriptlang.org)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

</div>

你的 agent 每次会话都重读同样的文件，想明白一件事，然后忘掉。easymem 给它一个
地方放学到的东西：一个它自己写的 markdown wiki，下次直接搜 wiki，不用再读文件。

easymem 里面没有模型。管道另一端那个 agent 就是模型 —— 它读、它判断一个页面该
写什么、它写。easymem 只做模型不擅长的事：全文搜索、链接图，以及记住上次之后
哪些文件变了。

## 看它工作

agent 为一个结算系统写的两个页面：

```markdown
# Checkout Flow
Payment is authorized at checkout and captured only when the parcel ships.
- A refund before shipment is free, because nothing was captured.
Driven by [[Order Service]].
```

```markdown
# Order Service
`OrderService.createOrder` owns the cart to order transition.
- Rejects an empty cart before touching the database.
```

现在问退款的事。**「refund」这个词只出现在第一个页面里：**

```bash
npx easymem search "refund"
```

```json
{
  "results": [
    {
      "title": "Checkout Flow",
      "snippet": "Money moves at shipment.",
      "hop": 0,
      "score": 0.96
    },
    {
      "title": "Order Service",
      "snippet": "Cart to order.",
      "hop": 1,
      "via": "Checkout Flow",
      "score": 0.48
    }
  ]
}
```

第二条结果里**一个 refund 都没有**。它能出来，是因为第一条链接到了它 ——
`hop: 1`，`via` 记录了它是从 Checkout Flow 走过来的。

这就是全部的想法。你问了一个策略问题，拿回来的是**策略，加上它依赖的那段代码**。
`grep` 做不到，纯全文搜索也做不到 —— 这个联系存在于 agent 写下的一条链接里，
不在字面上。

信一条结果之前先看 `hop`：`0` 是字面命中，更高的是顺链接找到的上下文，
`via` 告诉你它从哪条链接过来。

## 快速开始

不用装任何东西。

### 让你的 AI 用

装上 skill，或者直接跟它说 —— 下面每个子命令都是 agent 能执行的 shell 命令。

> 把 `src/` 和 `docs/` 下面的都读一遍，建成 wiki。

> 关于结算流程，我们已经知道些什么？

> 跑一下 lint，告诉我哪些内容烂掉了。

### 命令行

```bash
npx easymem search "结算流程是怎么走的"   # 搜索，然后顺着链接走
npx easymem list                          # 所有页面
npx easymem guide                         # 写页面的规则
npx easymem lint                          # 哪些内容已经过期
npx easymem --help
```

### 接成 MCP server

工具完全一样，但索引会常驻内存 —— 长会话、大 wiki 时更划算。加上这段然后重启：

```json
{
  "mcpServers": {
    "easymem": { "command": "npx", "args": ["-y", "easymem"] }
  }
}
```

Codex 用 `~/.codex/config.toml`，opencode 用 `opencode.json`，command 和 args
一样。

## 工具

| 命令行 | MCP 工具 | 做什么 |
| --- | --- | --- |
| `easymem search` | `wiki_search` | 全文搜索，然后顺着 `[[链接]]` 走 |
| `easymem read` | `wiki_read` | 读一个页面 |
| `easymem list` | `wiki_list` | 所有页面：id、标题、类型、路径 |
| `easymem graph` | `wiki_graph` | 链接图 —— 枢纽页和孤儿页 |
| `easymem lint` | `wiki_lint` | 哪些内容已经不再成立 |
| `easymem guide` | `wiki_guide` | 写作规则，运行时直接交给 agent |
| `easymem pending` | `wiki_pending` | 哪些源文件是新的或改过的 |
| `easymem write` | `wiki_write` | 写一个页面 |
| `easymem delete` | `wiki_delete` | 删一个页面 |
| `easymem reindex` | `wiki_reindex` | 重建索引、链接图和 `index.md` |

每一行是同一份实现的两个入口，所以命令行和 MCP 不可能给出不同的答案。

## 让它保持为真

wiki 是派生数据，风险不在于重复，而在于**漂移** —— 而过期的页面看不出过期。

```bash
npx easymem lint
```

| 检查 | 含义 |
| --- | --- |
| `outdated` | 源文件在页面写完之后**内容变了** |
| `staleSources` | 源文件没了，这页可能在描述一个不存在的东西 |
| `untracked` | 源文件从没被 ingest 过，没有任何东西盯着它 |
| `danglingLinks` | `[[链接]]` 后面没有页面 |
| `orphans` | 没人链接到这里 |
| `missingSources` | 这页什么都没声明，任何断言都无法核对 |
| `missingLinks` | 正文提到了另一个页面却没链过去 |
| `reviewForContradiction` | 出自同一份源文件的页面，值得放在一起读 |

`outdated` 比的是 sha256 不是时间戳，所以你重新格式化一个文件，不会把引用它的
页面全报一遍。`reviewForContradiction` 返回的是**候选，不是结论** ——
两个页面完全可以从不同角度描述同一份文件而互不矛盾，**改写一个本来没错的页面，
代价比放着不管更大**。

## 它不做什么

- **它不翻译。** 分词器在同一个索引里处理中英文，所以中文写的 wiki 能用中文搜。
  但它**不会**拿英文 wiki 回答中文问题。
- **它不自己读你的文件。** 那是 agent 的活。easymem 打开源文件只为了算哈希。
- **它不判断对错。** `lint` 只报告，判断是你和 agent 的事。
- **小项目不值得用。** 二十个整齐的文件，`grep` 更快。它挣回成本的场景是源料
  很大、很散、或者读起来很贵。

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
└── .state/                   内容哈希 —— 这个加进 .gitignore
```

没有数据库。搜索索引和链接图是启动时从 markdown 在内存里现建的，`wiki_reindex`
时重建 —— 1000 个页面约 120 ms，5000 个约 230 ms。什么都不缓存，因为不需要：
页面**就是**唯一的真相来源。

删掉 `.state/`，下次运行把所有源文件重读一遍，除了时间什么都不会丢。
删掉 easymem，你手里剩下的还是一个谁都能读的笔记文件夹。

这个仓库自己的 wiki 就在 [`.easymem/wiki/`](.easymem/wiki)，由 agent 读本仓库
源码写成。

## 开发

```bash
npm install
npm run dev      # 直接从 src 跑 MCP server，走 stdio
npm run lint
npm test         # jest 单元测试，带覆盖率
npm run build    # tsc → dist/，dist/cli.js 是发布的可执行文件
npm run ci       # build + typecheck + test，和 CI 跑的完全一样
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
同一个想法，但外面套了真正的约束：固定的页面格式、真的分词器、链接图。
加上这些约束之后，效果确实好了不少。

它也确实很重 —— LLM 客户端、HTTP API、控制台、多租户存储、SQLite 索引。
但有时候我们只是想要一个轻量的 wiki，帮一下手上已经有的那个 agent。
所以 easymem 把里面的 `MemoryKnowledge` 引擎抽了出来 —— 中英混合分词器、
多跳图搜索、页面格式 —— 放到一个命令行和一个 MCP 接口后面。没有别的东西。

## 许可

MIT。TencentDB-Agent-Memory 也是 MIT。
