# การตั้งค่า relay บน hostAtom (Plesk)

`src/relay/send-drafts.ts` ดึงอีเมล draft จาก Gmail (IMAP) แล้วส่งออกจริงผ่าน SMTP จากนั้นลบ draft ที่ส่งแล้วออก ต้องรันตามรอบเวลาบนเซิร์ฟเวอร์ hostAtom เพราะ cloud routine ของ Claude ไม่ได้ส่งอีเมลออกเอง มีแค่สร้าง draft ทิ้งไว้เท่านั้น

hostAtom ใช้ **Plesk** (ไม่ใช่ cPanel) และ Node.js runtime ที่ Plesk ใช้รันแอปนั้นอยู่นอก jail ที่ Scheduled Tasks แบบ "Run a command" มองเห็น (เช็คแล้วไม่มี `/opt`, `/usr/local` และหา `node` ใน PATH ไม่เจอเลยจากบริบทนั้น) ดังนั้นจึงรัน `node` ตรงๆ จาก cron ไม่ได้ ต้องใช้สถาปัตยกรรมนี้แทน:

```
Plesk Scheduled Task ("Fetch a URL", ทุกวัน)
      ↓ HTTP GET พร้อม token ลับ
Node.js App (Passenger) รัน src/server.ts แบบ persistent
      ↓ เรียกฟังก์ชัน sendDrafts()
Gmail (IMAP ดึง draft) -> SMTP (ส่งจริง) -> ลบ draft
```

`src/server.ts` เป็น Express server ที่มี endpoint เดียวคือ `GET /relay/send-drafts?token=...` ตรวจ token กับ `RELAY_SECRET` ก่อนเรียก `sendDrafts()` ทุกครั้ง — endpoint นี้เปิดสู่สาธารณะผ่าน URL จริง จึงต้องมี token กันคนอื่นมายิงให้ส่งอีเมลมั่ว

## 1. อัปโหลดโค้ด

อัปโหลดทั้งโปรเจกต์ (`src/`, `package.json`, `package-lock.json`, `tsconfig.json`) ขึ้นไปที่ path ของแอปบน hostAtom (เช่นผ่าน Git deploy ในเมนู Node.js/Git ของ Plesk)

## 2. ติดตั้ง dependencies และ build

ผ่านปุ่ม **"Run Node.js commands"** ในหน้า Node.js panel (เพราะมันรันในบริบทที่มองเห็น Node.js runtime ของ Plesk จริง ต่างจาก Scheduled Tasks):

```bash
npm install
npm run build
```

`npm run build` compile TypeScript ใน `src/` ออกมาที่ `dist/` (กำหนดด้วย `rootDir`/`outDir` ใน `tsconfig.json`) ทำซ้ำทุกครั้งที่อัปเดตโค้ด ต้องติดตั้งรวม devDependencies ด้วย (ห้ามใช้ `--production`) เพราะ `typescript` เป็น devDependency ที่ใช้ตอน build

## 3. สร้างไฟล์ .env บนเซิร์ฟเวอร์

สร้างไฟล์ `.env` ที่ root ของโปรเจกต์บน hostAtom (ห้าม commit ขึ้น git):

```
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
FROM_NAME=Arcana Content
SENT_MAIL=...
RELAY_SECRET=...
```

- `SMTP_USER` / `SMTP_PASS` ต้องเป็นบัญชี Gmail เดียวกับที่ Gmail MCP connector ใช้สร้าง draft (ใช้ App Password ของ Gmail ถ้าเปิด 2FA อยู่ ไม่ใช่รหัสผ่านจริง)
- `SENT_MAIL` คือปลายทางที่จะส่งอีเมลออกจริง (ใส่ได้หลายที่อยู่ คั่นด้วย comma)
- `RELAY_SECRET` เป็นค่าลับที่คิดเองยาวๆ แบบสุ่ม ใช้ค่าเดียวกับที่จะใส่ใน URL ของ Scheduled Task ด้านล่าง

## 4. ตั้งค่า Node.js App ใน Plesk

ในหน้า **Node.js** ของโดเมน:

- **Enable Node.js** (ถ้าปิดอยู่ ให้กด Enable กลับ)
- **Application Startup File:** `dist/server.js`
- กด **Restart App** หลังแก้ค่าใดๆ

แอปนี้ต้อง `listen()` ค้างไว้ตลอด (ไม่ใช่สคริปต์ที่รันจบแล้วออกแบบเดิม) — `src/server.ts` เขียนไว้ให้ทำงานแบบนี้อยู่แล้ว จึงไม่มีปัญหา Passenger คิดว่าแอป crash แล้ว restart วนซ้ำเหมือนตอนใช้ `send-drafts.js` เป็น startup file ตรงๆ

ทดสอบว่าแอปขึ้นจริง เปิด `https://arcana-mcp.system-samt.com/relay/send-drafts?token=<ใส่ RELAY_SECRET จริง>` ในเบราว์เซอร์ ควรได้ JSON กลับมา เช่น `{"sent":0,"subjects":[]}` (ถ้าไม่มี draft ใหม่) — ถ้าใส่ token ผิดจะได้ `401 {"error":"unauthorized"}`

## 5. ตั้ง Scheduled Task แบบ "Fetch a URL"

ในเมนู **Scheduled Tasks** ของโดเมน เพิ่มรายการใหม่:

- **Task type:** Fetch a URL (ไม่ใช่ "Run a command" หรือ "Run a PHP script")
- **URL:** `https://arcana-mcp.system-samt.com/relay/send-drafts?token=<RELAY_SECRET เดียวกับใน .env>`
- **Run:** Daily เวลาหลัง 09:00 น. เล็กน้อย เช่น 10:00 (เผื่อเวลาให้ cloud routine สร้าง draft เสร็จก่อน)
- **Notify:** เลือก "Errors only" จะได้รู้ทันทีถ้า endpoint ตอบ error/401

กด **Run Now** ทดสอบหนึ่งครั้งก่อนเชื่อว่าใช้งานได้จริง

## ลำดับการทำงานทั้งระบบ

```
09:00 (จ-ส) Anthropic cloud routine อ่าน knowledge base -> สร้าง Gmail draft
      ↓
10:00 (ทุกวัน) Plesk Scheduled Task ("Fetch a URL") -> ยิง /relay/send-drafts?token=...
      ↓
Node.js App (Passenger, persistent) -> ดึง draft (IMAP) -> ส่งจริง (SMTP) -> ลบ draft
```
