# VPS デプロイ（apps.andplus.tech）

本番の配置先は **ドキュメントルート配下**とし、WordPress と同列に置きます。

```text
/var/www/apps.andplus.tech/wordpress   ← 既存（参考）
/var/www/apps.andplus.tech/cscart      ← 本番の clone 先（LP ルート。/home/mmochi/cscart には置かない）
```

`~/cscart/...` や `/opt/andplus-cscart-lp` など **別パスに置く想定の手順は使わない**こと。

LP 本体は **Express（`app.js`）** です。`_rules` サブモジュールは **実行時不要**（開発用 Cursor ルールのみ）なので、本番 clone では `--no-recurse-submodules` で十分です。

## 1. 初回 clone

`/var/www/...` は root 所有のことが多いので、`sudo` で clone してからデプロイ用ユーザーに `chown` する。

```bash
sudo mkdir -p /var/www/apps.andplus.tech
cd /var/www/apps.andplus.tech
sudo git clone --no-recurse-submodules https://github.com/mmochi/andplus-cscart-lp.git cscart
sudo chown -R "$USER:$USER" /var/www/apps.andplus.tech/cscart
cd cscart
npm ci
cp .env.example .env
nano .env   # PORT, NODE_ENV=production, Freemius 等
```

秘密は **VPS 上の `.env` のみ**に書き、`git add` しないこと（`.gitignore` に `.env` あり）。

## 2. 動作確認

```bash
NODE_ENV=production PORT=3006 node app.js
# 別端末: curl -sI http://127.0.0.1:3006/
```

## 3. 更新デプロイ

```bash
cd /var/www/apps.andplus.tech/cscart
git pull
npm ci
sudo systemctl restart safecache-lp
```

## 4. systemd

`deploy/safecache-lp.service.example` を `/etc/systemd/system/safecache-lp.service` にコピーし、`User` / `WorkingDirectory` / `EnvironmentFile` を環境に合わせて編集:

```bash
sudo cp deploy/safecache-lp.service.example /etc/systemd/system/safecache-lp.service
sudo nano /etc/systemd/system/safecache-lp.service
sudo systemctl daemon-reload
sudo systemctl enable --now safecache-lp
```

## 5. nginx

`deploy/nginx-location.example.conf` を `server { }` 内に取り込み、`proxy_pass` のポートを `.env` の `PORT` と一致させる。
