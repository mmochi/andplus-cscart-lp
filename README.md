# AP SafeCache — CS-Cart 向けマーケティング LP

Express + EJS + gettext（`.po`）のバイリンガル LP です。

**GitHub:** https://github.com/mmochi/andplus-cscart-lp

## 必要環境

- Node.js 18+（推奨 LTS）

## 開発

```bash
git clone https://github.com/mmochi/andplus-cscart-lp.git
cd andplus-cscart-lp
npm ci
cp .env.example .env
# .env を編集
npm start
```

## 本番デプロイ（VPS）

**[deploy/VPS.md](deploy/VPS.md)**（`~/cscart/safecache` に clone、systemd / nginx 例）

## 開発ルール（andplus-dev-rules）— 任意

Cursor 用ルールは `_rules` サブモジュール（**実行時不要**）。

```bash
git submodule update --init --recursive
```

詳細は従来どおり [reference/README.md](reference/README.md)（サブモジュール未 clone でも LP は起動します）。
