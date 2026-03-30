import prisma from './prisma.js'

async function main() {
  // Default notification rules
  const rules = [
    { name: '到期前7天提醒', daysBefore: 7, timeOfDay: '09:00', channels: JSON.stringify(['telegram']) },
    { name: '到期前3天提醒', daysBefore: 3, timeOfDay: '09:00', channels: JSON.stringify(['telegram']) },
    { name: '到期當天提醒', daysBefore: 0, timeOfDay: '09:00', channels: JSON.stringify(['telegram', 'calendar']) },
  ]

  for (const rule of rules) {
    await prisma.notificationRule.upsert({
      where: { id: rule.name },
      update: rule,
      create: rule,
    })
  }

  console.log('Seed completed: notification rules created')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
