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

easymem 把你的编码 agent 读到的东西变成一个本地 markdown wiki，下次会话直接搜
wiki，不用重读文件。

搜索是全库 BM25，然后顺着 `[[链接]]` 走一跳 —— 一个完全没提到你关键词的页面，
只要有命中的页面链接到它，它就会被带出来。产出是普通 markdown，能读、能改、能
提交进 git。easymem 里面没有模型，也没有数据库：agent 负责写，easymem 负责存、
搜、连。

## 快速开始

### 交给你的 AI

```bash
npx skills add zhangxiangliang/easymem
```

这会把 skill 装进 Claude Code、Cursor、Codex 等工具。之后 AI 会自己把读到的东西
写进 wiki，下次先搜 wiki，不用把文件再读一遍。

不想装 CLI？把下面这句话丢给你的 AI，剩下的它自己搞定：

> Read and follow https://github.com/zhangxiangliang/easymem/blob/main/SKILL.md

### 命令行

不用装，`npx` 第一次运行会自动拉包。

```bash
npx easymem search "结算流程是怎么走的"
npx easymem --help
```

### 接成 MCP server

索引常驻内存，长会话更划算。加上这段然后重启：

```json
{
  "mcpServers": {
    "easymem": { "command": "npx", "args": ["-y", "easymem"] }
  }
}
```

页面落在 `.easymem/wiki/`。这些要提交进 git；`.easymem/.state/` 加进 `.gitignore`。

## 文档

- [参考手册](docs/reference.zh.md) —— 每个指令、search 返回什么、`lint` 检查
  什么、磁盘上有什么，以及它不做什么。

## 这东西是怎么来的

想法来自 Andrej Karpathy 的
[LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)：
别每次提问都对原始资料重跑一遍 RAG，让 agent 把读到的东西**编译**成一个 wiki，
之后从 wiki 里回答。我在自己的知识库里用这个模式用了很久。它有效，但效果不算好：
只靠一段提示词，agent 每天写出来的页面都是不同的形状，而一个每页长得都不一样的
wiki 是一堆散沙。

[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
是同一个想法，但外面套了真正的约束，效果好得多。它也确实很重 —— LLM 客户端、
HTTP API、控制台、多租户存储、SQLite 索引。easymem 把里面的 `MemoryKnowledge`
引擎抽了出来 —— 中英混合分词器、多跳图搜索、页面格式 —— 放到一个命令行后面。
没有别的东西。

## 许可

MIT。TencentDB-Agent-Memory 也是 MIT。
