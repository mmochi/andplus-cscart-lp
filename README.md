# CS-Cart アドオン販売用 LP（予定）

**方針・技術スタックは未確定です。** 実装に着手する前に要件と `wordpress/schemabridge`（SchemaBridge LP）との揃え方を決めます。

**GitHub:** https://github.com/mmochi/andplus-cscart-lp  

```bash
git clone https://github.com/mmochi/andplus-cscart-lp.git
cd andplus-cscart-lp
git submodule update --init --recursive
```

## LP の置き場所（参照）

- 同一モノレポ内の WordPress 向け LP: `../wordpress/schemabridge`（Next.js App Router）
- 本リポジトリでは、**同様の Next.js 構成で CS-Cart 向け LP を置く**想定でディレクトリを切っています（アプリ本体は未作成）。

## 開発ルール（andplus-dev-rules）

[andplus-dev-rules の `reference/README.md`](reference/README.md) の **サブモジュール方式**に従います（`cscart-ap-safecache` と同じ付け方）。

### ディレクトリ構成

```
cscart/
├─ _rules/                # andplus-dev-rules（git submodule）
│  ├─ .cursor/rules/
│  ├─ reference/
│  └─ components/
├─ .cursor/
│  └─ rules -> ../_rules/.cursor/rules
├─ reference -> _rules/reference
├─ components -> _rules/components
└─ README.md
```

- **人向けの入口:** [reference/README.md](reference/README.md)
- **Cursor ルール:** `.cursor/rules/`（`base.mdc` など）

### 初回 clone 後

```bash
git submodule update --init --recursive
```

### ルールを更新したあと（このリポジトリ側で取り込む）

```bash
git submodule update --remote _rules
```

### ゼロから同じ構成を再現するとき

```bash
cd /path/to/cscart
git submodule add https://github.com/mmochi/andplus-dev-rules.git _rules
mkdir -p .cursor
ln -sfn ../_rules/.cursor/rules .cursor/rules
ln -sfn _rules/reference reference
ln -sfn _rules/components components
```

Organization 用の submodule URL は `team-andplus/andplus-dev-rules` など、[reference/README.md](reference/README.md) の例に合わせて差し替えてください。
