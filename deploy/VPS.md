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

## 4. systemd（**自動起動・常駐**）

手動の `node app.js` は SSH を切ると止まる。**再起動後も動かす**には systemd に登録する。

`deploy/safecache-lp.service.example` を `/etc/systemd/system/safecache-lp.service` にコピーし、`User` / `WorkingDirectory` を **`app.js` があるディレクトリ**に合わせて編集（例は **`.../cscart/safecache`** 前提）。

**本番で共通 env を別パスに置く場合**（例: `/var/www/apps.andplus.tech/andplus-apps/common/cscart-ap-safecache_lp.env`）は、`app.js` が対応している **`CSCART_AP_SAFECACHE_ENV`** を systemd の `Environment=` でその **絶対パス**に設定する（例ファイルに記載）。**`Environment=PORT=`** は nginx の `proxy_pass` と同じ番号にし、**`.env` の `PORT` とズレても listen はユニット側が優先**しやすい。

```bash
cd /var/www/apps.andplus.tech/cscart/safecache   # 実際のリポジトリルートへ
sudo cp deploy/safecache-lp.service.example /etc/systemd/system/safecache-lp.service
sudo nano /etc/systemd/system/safecache-lp.service
sudo systemctl daemon-reload
sudo systemctl enable --now safecache-lp
```

- **`enable`** … OS 起動時に自動起動  
- **`--now`** … いますぐ起動  

状態確認: `systemctl status safecache-lp` / ログ: `journalctl -u safecache-lp -f`

**常駐:** 例のユニットは **`Restart=always`**（プロセスが落ちたら数秒後に自動再起動）。OS 再起動後も動かすには **`systemctl enable safecache-lp`** が必要（`enable --now` で登録＋即起動まで一度でできる）。

## 5. nginx

`deploy/nginx-location.example.conf` を `apps.andplus.tech` の **`server { ... }`** 内に取り込む。

- 公開 URL が **`https://apps.andplus.tech/cscart/safecache/`** のときは **パターン C**（同ファイル内）。`proxy_pass` のポートは **`.env` の `PORT`** と同じにする（例: `3006`）。
- **`proxy_pass` の URL は末尾 `/` 付き**（例: `http://127.0.0.1:3006/`）にし、`location` も `/cscart/safecache/` のように **末尾 `/` 付き**にすると、Node には `/` だけ渡り、LP の `public/style.css` 等と整合する。
- **サブパス配信では** `location` ブロックに **`proxy_set_header X-Forwarded-Prefix /cscart/safecache;`** を入れる（**必須推奨**）。Node はこれで CSS/JS・言語リンクのプレフィックスを決める。併せて **`proxy_pass` は末尾 `/` 付き**のまま。
- 代替: 共通 env に **`BASE_PATH=/cscart/safecache`**（`X-Forwarded-Prefix` より優先されない。**ヘッダが無いときのフォールバック**）。

編集後:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. トラブルシュート

### `npm ci` が `EACCES` / `permission denied` で `node_modules` を作れない

`/var/www/...` が **root や他ユーザー所有**のとき起きる。デプロイユーザー（例: `mmochi`）に **再帰で所有者を渡す**。

```bash
sudo chown -R mmochi:mmochi /var/www/apps.andplus.tech/cscart
```

そのうえで、**`app.js` があるディレクトリ**で `npm ci` をやり直す。

### `.../cscart/safecache` のように一段深い場所に置いている

どちらでもよいが、**systemd の `WorkingDirectory`** と **`cd` 先**は **`app.js` があるディレクトリ**にそろえる（例: `WorkingDirectory=/var/www/apps.andplus.tech/cscart/safecache`）。ドキュメントの既定は **`.../cscart` がリポジトリ直下**の想定。

### ブラウザが **403**（`/cscart/safecache/` など）

多くは **nginx がディレクトリを静的配信しようとしている**だけ（`index` が無く `autoindex` も off → 403）。**`location` で `proxy_pass` して Node に渡す**（上記 §5・`nginx-location.example.conf` パターン C）。あわせて **`systemctl status safecache-lp`** で Node が listen しているか確認する。

### `proxy_pass` は **末尾に `/` 必須**（サブパス公開時）

`proxy_pass http://127.0.0.1:3007;` のように **ポートだけで終わっている**と、Node には **`/cscart/safecache/` がそのまま渡る**。この LP は **`/` 前提**なので **`http://127.0.0.1:3007/`** のように **`/` で終える**（`deploy/nginx-location.example.conf` パターン C と同じ形）。

### **CSS / JS が読み込めない**／**言語リンクがルートに飛ぶ**

サブパス（例: `/cscart/safecache/`）のとき、nginx に **`proxy_set_header X-Forwarded-Prefix /cscart/safecache;`** が無いと、HTML は **`/style.css`** のままになり **ドメイン直下**を見に行く。§5 の例のとおり **`location` に追加**して `nginx -t` → `reload`。あわせて **LP の `git pull` 後** `sudo systemctl restart safecache-lp`（`X-Forwarded-Prefix` を読むコードが必要）。

### **502 Bad Gateway**

nginx は動いているが **127.0.0.1 の Node に繋がっていない**ときに出る。次を **同じ順**で確認する。

1. **ポート一致** … `proxy_pass` のポート（例: `3007`）と、**`/var/www/.../cscart/.../.env` の `PORT=`** が同じか。`systemctl` 使う場合は **`EnvironmentFile=`** がその `.env` を指しているか。
2. **プロセスが動いているか** … `systemctl status safecache-lp` が **active (running)** か。違うなら `journalctl -u safecache-lp -n 80 --no-pager` で **起動失敗理由**（`Cannot find module` / `EADDRINUSE` / `.env` 未配置など）を見る。
3. **ローカルで応答があるか** … サーバー上で `curl -sI http://127.0.0.1:3007/`（ポートは自分の値に合わせる）。**Connection refused** なら Node が listen していない。
4. **手動起動テスト** … `app.js` があるディレクトリで `NODE_ENV=production PORT=3007 node app.js` を一時的に実行し、別シェルから `curl -sI http://127.0.0.1:3007/`。ここで動けば **systemd の `WorkingDirectory` / `User` / `EnvironmentFile`** を疑う。

よくある原因: **`npm ci` 未実行**で `node_modules` が無い、`WorkingDirectory` が **`app.js` の無いパス**、**別ポート**のまま nginx だけ直した。
