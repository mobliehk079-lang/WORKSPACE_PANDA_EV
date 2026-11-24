# Panda EV – 3D Characters (glTF Binary .glb)

| ไฟล์ | ตัวละคร |
|---|---|
| panda_hero_pink_hoodie.glb | ตัวหลัก (Hero) ฮู้ดชมพู |
| panda_green_cap.glb | หมวกเขียว + แจ็คเก็ตเขียว |
| panda_pink_bow.glb | โบว์ชมพู + แจ็คเก็ตชมพู |
| panda_smart_glasses.glb | แว่นตา + แจ็คเก็ตเขียว |

## สเปกสำหรับใช้ในเกม
- หน่วย: 1 unit ≈ 1 เมตร, ตัวสูงประมาณ 1.05–1.12 unit
- จุด origin อยู่ที่ "เท้า" (y = 0) ตรงกลางตัว → วางบนพื้นได้ทันที
- หันหน้าไปทาง +Z, แกน Y ชี้ขึ้น (มาตรฐาน glTF)
- วัสดุ: PBR สีล้วน (ไม่มี texture), low-poly ~ 15k triangles/ตัว
- ไม่มี skeleton/animation ในไฟล์ — แต่แยกชิ้นเป็น node ที่มีจุดหมุน (pivot) พร้อมให้ขยับด้วยโค้ด:
  - `Head` – pivot ที่คอ (ลูกของมันคือหน้า หู ตา หมวก/โบว์/แว่น)
  - `Arm_L`, `Arm_R` – pivot ที่ไหล่ (หมุนแกน Z เพื่อยกแขน)
  - `Leg_L`, `Leg_R` – pivot ที่สะโพก (หมุนแกน X เพื่อก้าว/งอขา)
  - `Body` – ลำตัว/เสื้อ

## Prompt แนะนำสำหรับให้ AI ทำเกม
"สร้างเกม 3D platformer ด้วย Three.js โหลดตัวละครจาก panda_hero_pink_hoodie.glb (origin ที่เท้า หันหน้า +Z สูง ~1 unit)
ทำ animation ด้วยโค้ดโดยหมุน node Arm_L/Arm_R (แกน Z), Leg_L/Leg_R (แกน X), Head
ตอนกระโดดให้ squash & stretch ที่ root node ใช้ตัวอื่นเป็น NPC หรือตัวเลือกให้ผู้เล่น"

## ใช้ในเกม Panda Jump (Workspace → Minigame)
ไฟล์ .glb ย้ายไปอยู่ที่ `public/models/panda/` แล้ว (เซิร์ฟเวอร์ของ Workspace เสิร์ฟให้เบราว์เซอร์)
โค้ดเกมอยู่ที่ `public/js/jump/` (rig.js = ขยับตัวละครด้วยโค้ดตามสเปกข้างบน) — ดูรายละเอียดใน README.md หลักของ Workspace
