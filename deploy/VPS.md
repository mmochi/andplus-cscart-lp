# VPS デプロイ（apps.andplus.tech）

本番の配置先は **ドキュメントルート配下**とし、WordPress と同列に置きます。

```text
/var/www/apps.andplus.tech/wordpress   ← 既存（参考）
/var/www/apps.andplus.tech/cscart      ← 本番の clone 先（LP ルート。/home/mmochi/cscart には置かない）
```

`~/cscart/...` や `/opt/andplus-cscart-lp` など **別パスに置く想定の手順は使わない**こと。

LP 本体は **Express（`app.js`）** です。`_rules` サブモジュールは **実行時不要**（開発用 Cursor ルールのみ）なので、本番 clone では `--no-recurse-submodules` で十分です。

## FTP / SFTP で置いてよい？

**よい。** 置き先は **`/var/www/apps.andplus.tech/cscart`**（WordPress と同列）。多くのクライアントは **SFTP**（FTP over SSH）で同じパスにアップロードする。

次だけ守ること。

- **`node_modules` はアップしない**（容量が大きく、OS 違いで壊れやすい）。サーバーで `npm ci` する。
- **`.env` はリポジトリに含めず**、サーバー上で `.env.example` をコピーして編集するか、SFTP で **本番用だけ**置く。
- **`.git` は無くても動く**（あとから `git clone` に切り替えてもよい）。

アップロード後、**所有者をデプロイユーザーに寄せてから** `npm ci` する（`/var/www` は `root` 所有になりがちで、そのままだと **EACCES** になる）。

```bash
sudo chown -R "$USER:$USER" /var/www/apps.andplus.tech/cscart
cd /var/www/apps.andplus.tech/cscart   # または下の「safecache」配下に置いた場合はそのパスへ cd
npm ci
# .env が未作成なら: cp .env.example .env && nano .env
```

続けて **systemd / nginx** はこのドキュメントの後半どおり。

## 0. 手元からディレクトリ作成＋ git clone（推奨）

**SSH 鍵のある自分の Mac / PC** で実行する（`/tmp/vps-init.sh` が無いと言われたら → **A** を使う。`scp` を忘れるとそのエラーになる）。

### A. GitHub から直接流し込む（scp 不要・推奨）

```bash
ssh -t mmochi@apps.andplus.tech "curl -fsSL https://raw.githubusercontent.com/mmochi/andplus-cscart-lp/master/deploy/vps-init.sh | bash"
```

`curl` が無いサーバーなら次。

```bash
ssh -t mmochi@apps.andplus.tech "wget -qO- https://raw.githubusercontent.com/mmochi/andplus-cscart-lp/master/deploy/vps-init.sh | bash"
```

### B. 手元の `vps-init.sh` をアップしてから実行

```bash
cd /path/to/andplus-cscart-lp   # 本リポジトリのディレクトリ
scp deploy/vps-init.sh mmochi@apps.andplus.tech:/tmp/vps-init.sh
ssh -t mmochi@apps.andplus.tech 'bash /tmp/vps-init.sh'
```

`scp` のあと **`ls -la /tmp/vps-init.sh`** でファイルがあるか確認してから `bash` する。

既に `/var/www/apps.andplus.tech/cscart` がある場合は **git pull のみ**（上書きしない）。

## 1. 初回 clone（手動で行う場合）

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

## 6. トラブルシュート

### `npm ci` が `EACCES` / `permission denied` で `node_modules` を作れない

`/var/www/...` が **root や他ユーザー所有**のとき起きる。デプロイユーザー（例: `mmochi`）に **再帰で所有者を渡す**。

```bash
sudo chown -R mmochi:mmochi /var/www/apps.andplus.tech/cscart
```

そのうえで、**`app.js` があるディレクトリ**で `npm ci` をやり直す。

### `.../cscart/safecache` のように一段深い場所に置いている

どちらでもよいが、**systemd の `WorkingDirectory`** と **`cd` 先**は **`app.js` があるディレクトリ**にそろえる（例: `WorkingDirectory=/var/www/apps.andplus.tech/cscart/safecache`）。ドキュメントの既定は **`.../cscart` がリポジトリ直下**の想定。
