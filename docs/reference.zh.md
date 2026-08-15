# easymem 参考

[English](reference.md) · [简体中文](reference.zh.md) · [← README](../README.zh.md)

## 指令

| 命令行 | MCP 工具 | 做什么 |
| --- | --- | --- |
| `easymem search <查询>` | `wiki_search` | 全文搜索，然后顺着 `[[链接]]` 走 |
| `easymem read <路径>` | `wiki_read` | 读一个页面 |
| `easymem list` | `wiki_list` | 所有页面：id、标题、类型、路径 |
| `easymem graph` | `wiki_graph` | 链接图 —— 枢纽页和孤儿页 |
| `easymem lint` | `wiki_lint` | 死链、孤儿页、被源码甩在后面的页面 |
| `easymem guide` | `wiki_guide` | agent 写页面时遵循的规则 |
| `easymem pending <路径>...` | `wiki_pending` | 哪些源文件是新的或改过的 |
| `easymem write` | `wiki_write` | 写一个页面 |
| `easymem delete <路径>` | `wiki_delete` | 删一个页面 |
| `easymem reindex` | `wiki_reindex` | 重建索引、链接图和 `index.md` |
| `easymem skill` | — | 打印 skill 文件 |

每一行是同一份实现的两个入口，所以命令行和 MCP 不可能给出不同的答案。
`skill` 是例外：装 skill 是你对 agent 做的事，不是 agent 向 wiki 要的东西。

全局选项：`--dir <路径>`（默认 `.easymem`，或用 `EASYMEM_DIR`）、`--help`、
`--version`。

`easymem` 不带子命令时启动 stdio MCP server。在终端里直接敲（没有管道输入），
它打印帮助。

### search

```bash
easymem search "退款是怎么处理的" --limit 10 --hop 1
```

`--hop 2` 拿的是答案周围的上下文而不是答案本身；`--hop 0` 只返回字面命中。

### write

```bash
easymem write --type concept --title "Checkout Flow" \
  --description "为什么钱在发货时才扣。" \
  --sources docs/checkout.md,src/payment.ts \
  --body-file page.md
```

`--body-file` 通常比 `--body` 好用：页面是多行 markdown，行内引号很容易出错。
也可以用管道把正文喂进去。

同样的 type + title 再写一次会覆盖那个页面。frontmatter 里写了 `locked: true`
的页面永远不会被覆盖 —— 调用返回 `skipped-locked`。

### ingest 循环

```bash
easymem pending src/**/*.ts docs/*.md    # 真正需要读的是哪些
# 读 to_ingest 里的每个路径，然后每个主题写一个页面
easymem reindex --ingested src/a.ts,docs/b.md
```

**不跑 `reindex`，搜索结果不会变。**

## search 返回什么

| 字段 | 怎么用 |
| --- | --- |
| `hop: 0` | 字面直接命中。可以当答案信 |
| `hop: 1` 及以上 | 顺着链接找到的。是上下文 —— 该读，但未必回答了你的问题 |
| `via` | 它从哪个页面走过来。`via` 看着不相干，说明那条链接有问题 |
| `score` | 只在同一批结果里可比，没有绝对阈值 |
| `snippet` | 够你判断要不要打开这页，不够你据此回答 |
| `related` | 图上的邻居。下一步该读什么，很便宜 |

search **不返回**页面的源文件。用 `read` 打开页面（在 frontmatter 里），
或者 `list` 一次拿到所有页面的来源。

## lint 检查什么

wiki 是派生数据，风险不在于重复，而在于**漂移** —— 而过期的页面看不出过期。

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

`summary` 给出每一类的计数，你一眼就能判断值不值得往下读。

`outdated` 比的是 sha256 不是时间戳，所以重新格式化一个文件，不会把引用它的
页面全报一遍。

`reviewForContradiction` 返回的是**候选，不是结论**。两个页面完全可以从不同角度
描述同一份文件而互不矛盾，**改写一个本来没错的页面，代价比放着不管更大**。
动手之前两个都读一遍。

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

没有数据库。搜索索引和链接图是启动时从 markdown 在内存里现建的，`reindex` 时
重建 —— 1000 个页面约 120 ms，5000 个约 230 ms。什么都不缓存，因为不需要：
页面**就是**唯一的真相来源。

删掉 `.state/`，下次运行把所有源文件重读一遍，除了时间什么都不会丢。
删掉 easymem，你手里剩下的还是一个谁都能读的笔记文件夹。

这个仓库自己的 wiki 就在 [`.easymem/wiki/`](../.easymem/wiki)，由 agent 读本仓库
源码写成。

## 它不做什么

- **它不翻译。** 分词器在同一个索引里处理中英文，所以中文写的 wiki 能用中文搜。
  但它**不会**拿英文 wiki 回答中文问题。
- **它不自己读你的文件。** 那是 agent 的活。easymem 打开源文件只为了算哈希。
- **它不判断对错。** `lint` 只报告，判断是你和 agent 的事。
- **小项目不值得用。** 二十个整齐的文件，`grep` 更快。它挣回成本的场景是源料
  很大、很散、或者读起来很贵。

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
