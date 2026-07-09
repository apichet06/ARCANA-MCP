# การตั้งค่า send-drafts.ts บน hostAtom

สคริปต์ `src/relay/send-drafts.ts` ทำหน้าที่ดึงอีเมล draft จาก Gmail (IMAP) แล้วส่งออกจริงผ่าน SMTP จากนั้นลบ draft ที่ส่งแล้วออก ต้องรันตามรอบเวลาบนเซิร์ฟเวอร์ hostAtom เพราะ cloud routine ของ Claude ไม่ได้ส่งอีเมลออกเอง มีแค่สร้าง draft ทิ้งไว้เท่านั้น

## 1. อัปโหลดโค้ด

อัปโหลดทั้งโปรเจกต์ (หรืออย่างน้อย `src/`, `package.json`, `package-lock.json`, `tsconfig.json`) ขึ้นไปยังพื้นที่ที่ hostAtom จัดสรรให้ เช่นผ่าน Git deploy, FTP หรือ File Manager ใน cPanel

## 2. ติดตั้ง dependencies และ build

เข้า SSH หรือ Terminal ใน cPanel แล้วรันที่ path ของโปรเจกต์:

```bash
npm install
npm run build
```

`npm run build` จะ compile TypeScript ใน `src/` ออกมาเป็น JS ที่ `dist/` (กำหนดด้วย `rootDir`/`outDir` ใน `tsconfig.json`) เช่น `dist/relay/send-drafts.js` — ทำขั้นตอนนี้ทุกครั้งที่อัปเดตโค้ดใหม่บนเซิร์ฟเวอร์

ต้องติดตั้งรวม devDependencies ตอน `npm install` ด้วย (ห้ามใช้ `--production`) เพราะ `typescript` เป็น devDependency ที่ใช้ตอน build แต่หลัง build เสร็จแล้ว การรันจริงใช้แค่ `node` เปล่าๆ ไม่ต้องพึ่ง `tsx` บนเซิร์ฟเวอร์อีก

## 3. สร้างไฟล์ .env บนเซิร์ฟเวอร์

สร้างไฟล์ `.env` ที่ root ของโปรเจกต์บน hostAtom (ไฟล์นี้ห้าม commit ขึ้น git) ใส่ค่าจริง:

```
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
FROM_NAME=Arcana
SENT_MAIL=...
```

- `SMTP_USER` / `SMTP_PASS` ต้องเป็นบัญชี Gmail เดียวกับที่ Gmail MCP connector ใช้สร้าง draft (ใช้ App Password ของ Gmail ถ้าเปิด 2FA อยู่ ไม่ใช่รหัสผ่านจริง)
- `SENT_MAIL` คือปลายทางที่จะส่งอีเมลออกจริง

## 4. ตั้ง Cron Job ใน cPanel

ไปที่เมนู **Cron Jobs** ใน cPanel ของ hostAtom แล้วเพิ่มรายการใหม่:

- **ความถี่:** ทุก 15-30 นาที เช่น `*/15 * * * *`
- **คำสั่ง:**
  ```bash
  cd /home/USERNAME/path/to/arcana-mcp && /usr/bin/node dist/relay/send-drafts.js >> /home/USERNAME/logs/send-drafts.log 2>&1
  ```
  (เทียบเท่ากับ `npm start` เพราะ script `start` ใน package.json ชี้ไปที่ `dist/relay/send-drafts.js` เหมือนกัน — เรียก `node` ตรงๆ ในบรรทัด cron จะเสถียรกว่าเพราะไม่ต้องพึ่งพา `npm` resolve PATH ทุกรอบ)

**อย่าใช้ `npm run send-drafts` บนเซิร์ฟเวอร์จริง** — script นั้นรันผ่าน `tsx` (compile สดทุกครั้ง) ซึ่งเปลืองและช้ากว่า ใช้เฉพาะตอน dev บนเครื่องตัวเองเท่านั้น บนเซิร์ฟเวอร์ให้ build ครั้งเดียวแล้วรัน `dist/relay/send-drafts.js` ที่ compile ไว้แล้วซ้ำๆ ผ่าน cron

แก้ `USERNAME`, path ของโปรเจกต์ และ path ของ `npm`/`node` ให้ตรงกับที่ hostAtom ใช้จริง (เช็คด้วย `which npm` และ `which node` ทาง SSH)

## 5. ทดสอบก่อนปล่อยรัน cron จริง

รันคำสั่งด้วยมือก่อนหนึ่งครั้งเพื่อดูว่าไม่มี error:

```bash
npm run build && npm start
```

ถ้าไม่มี draft ใหม่จะขึ้น `ไม่มี draft ใหม่ให้ส่ง` ถ้ามี draft จะเห็น `ส่งสำเร็จ: <หัวข้อ>` ต่อฉบับ แล้ว draft นั้นจะถูกลบออกจาก Gmail

## ลำดับการทำงานทั้งระบบ

```
09:00 (จ-ส) Anthropic cloud routine อ่าน knowledge base -> สร้าง Gmail draft
      ↓
ทุก 15-30 นาที hostAtom cron -> ดึง draft (IMAP) -> ส่งจริง (SMTP) -> ลบ draft
```
