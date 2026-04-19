import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clean up existing data
  console.log('🧹 Cleaning existing data...');
  await prisma.event.deleteMany();
  await prisma.log.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.transactionItem.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.salaryPayment.deleteMany();
  await prisma.unitProduct.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.setting.deleteMany();
  console.log('✅ Data cleaned');

  // Create Units
  const unit1 = await prisma.unit.upsert({
    where: { id: 'unit-1' },
    update: {},
    create: {
      id: 'unit-1',
      name: 'Cabang Jakarta',
      address: 'Jl. Sudirman No. 123, Jakarta',
      phone: '021-1234567'
    }
  });

  const unit2 = await prisma.unit.upsert({
    where: { id: 'unit-2' },
    update: {},
    create: {
      id: 'unit-2',
      name: 'Cabang Bandung',
      address: 'Jl. Asia Afrika No. 45, Bandung',
      phone: '022-7654321'
    }
  });

  const unit3 = await prisma.unit.upsert({
    where: { id: 'unit-3' },
    update: {},
    create: {
      id: 'unit-3',
      name: 'Cabang Surabaya',
      address: 'Jl. Tunjungan No. 78, Surabaya',
      phone: '031-9876543'
    }
  });

  console.log('✅ Units created');

  // Create Super Admin
  const hashedPassword = await bcrypt.hash('admin123', 10);
  
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@razkindo.com' },
    update: {},
    create: {
      id: 'user-admin',
      email: 'admin@razkindo.com',
      password: hashedPassword,
      name: 'Super Admin',
      phone: '081234567890',
      role: 'super_admin',
      status: 'approved',
      lastSeenAt: new Date()
    }
  });

  // Create Sales users
  const sales1 = await prisma.user.upsert({
    where: { email: 'sales.jkt@razkindo.com' },
    update: {},
    create: {
      id: 'user-sales-1',
      email: 'sales.jkt@razkindo.com',
      password: hashedPassword,
      name: 'Budi Santoso',
      phone: '081234567891',
      role: 'sales',
      unitId: unit1.id,
      status: 'approved',
      lastSeenAt: new Date()
    }
  });

  const sales2 = await prisma.user.upsert({
    where: { email: 'sales.bdg@razkindo.com' },
    update: {},
    create: {
      id: 'user-sales-2',
      email: 'sales.bdg@razkindo.com',
      password: hashedPassword,
      name: 'Siti Rahayu',
      phone: '081234567892',
      role: 'sales',
      unitId: unit2.id,
      status: 'approved',
      lastSeenAt: new Date()
    }
  });

  // Create Kurir users
  const kurir1 = await prisma.user.upsert({
    where: { email: 'kurir.jkt@razkindo.com' },
    update: {},
    create: {
      id: 'user-kurir-1',
      email: 'kurir.jkt@razkindo.com',
      password: hashedPassword,
      name: 'Agus Pratama',
      phone: '081234567893',
      role: 'kurir',
      unitId: unit1.id,
      status: 'approved',
      lastSeenAt: new Date()
    }
  });

  // Create Keuangan users
  const keuangan1 = await prisma.user.upsert({
    where: { email: 'keuangan.jkt@razkindo.com' },
    update: {},
    create: {
      id: 'user-keuangan-1',
      email: 'keuangan.jkt@razkindo.com',
      password: hashedPassword,
      name: 'Dewi Lestari',
      phone: '081234567894',
      role: 'keuangan',
      unitId: unit1.id,
      status: 'approved',
      lastSeenAt: new Date()
    }
  });

  console.log('✅ Users created');

  // Create Products
  const products = await Promise.all([
    prisma.product.upsert({
      where: { id: 'prod-1' },
      update: {},
      create: {
        id: 'prod-1',
        name: 'Kopi Arabika Premium',
        sku: 'KAP-001',
        category: 'Minuman',
        unit: 'kg',
        globalStock: 100,
        avgHpp: 80000,
        sellingPrice: 150000,
        minStock: 20
      }
    }),
    prisma.product.upsert({
      where: { id: 'prod-2' },
      update: {},
      create: {
        id: 'prod-2',
        name: 'Teh Hijau Organik',
        sku: 'THO-001',
        category: 'Minuman',
        unit: 'kg',
        globalStock: 50,
        avgHpp: 65000,
        sellingPrice: 85000,
        minStock: 10
      }
    }),
    prisma.product.upsert({
      where: { id: 'prod-3' },
      update: {},
      create: {
        id: 'prod-3',
        name: 'Gula Aren Murni',
        sku: 'GAM-001',
        category: 'Bahan Makanan',
        unit: 'kg',
        globalStock: 200,
        avgHpp: 45000,
        sellingPrice: 65000,
        minStock: 30
      }
    }),
    prisma.product.upsert({
      where: { id: 'prod-4' },
      update: {},
      create: {
        id: 'prod-4',
        name: 'Madu Hutan Asli',
        sku: 'MHA-001',
        category: 'Kesehatan',
        unit: 'botol',
        globalStock: 75,
        avgHpp: 120000,
        sellingPrice: 180000,
        minStock: 15
      }
    }),
    prisma.product.upsert({
      where: { id: 'prod-5' },
      update: {},
      create: {
        id: 'prod-5',
        name: 'Cokelat Bubuk Premium',
        sku: 'CBP-001',
        category: 'Minuman',
        unit: 'kg',
        globalStock: 60,
        avgHpp: 95000,
        sellingPrice: 140000,
        minStock: 10
      }
    })
  ]);

  console.log('✅ Products created');

  // Create Unit Products (stock per unit)
  await Promise.all([
    prisma.unitProduct.upsert({
      where: { id: 'up-1' },
      update: {},
      create: {
        id: 'up-1',
        unitId: unit1.id,
        productId: 'prod-1',
        stock: 40
      }
    }),
    prisma.unitProduct.upsert({
      where: { id: 'up-2' },
      update: {},
      create: {
        id: 'up-2',
        unitId: unit2.id,
        productId: 'prod-1',
        stock: 35
      }
    }),
    prisma.unitProduct.upsert({
      where: { id: 'up-3' },
      update: {},
      create: {
        id: 'up-3',
        unitId: unit3.id,
        productId: 'prod-1',
        stock: 25
      }
    }),
    prisma.unitProduct.upsert({
      where: { id: 'up-4' },
      update: {},
      create: {
        id: 'up-4',
        unitId: unit1.id,
        productId: 'prod-2',
        stock: 20
      }
    }),
    prisma.unitProduct.upsert({
      where: { id: 'up-5' },
      update: {},
      create: {
        id: 'up-5',
        unitId: unit1.id,
        productId: 'prod-3',
        stock: 80
      }
    })
  ]);

  console.log('✅ Unit products created');

  // Create Customers
  const customers = await Promise.all([
    prisma.customer.upsert({
      where: { id: 'cust-1' },
      update: {},
      create: {
        id: 'cust-1',
        name: 'PT. Maju Jaya Sentosa',
        phone: '021-5551234',
        email: 'purchase@majujaya.co.id',
        address: 'Jl. Industri No. 10, Jakarta Timur',
        unitId: unit1.id
      }
    }),
    prisma.customer.upsert({
      where: { id: 'cust-2' },
      update: {},
      create: {
        id: 'cust-2',
        name: 'CV. Berkah Sejahtera',
        phone: '022-5559876',
        email: 'order@berkahsejatera.com',
        address: 'Jl. Raya Bandung No. 45',
        unitId: unit2.id
      }
    }),
    prisma.customer.upsert({
      where: { id: 'cust-3' },
      update: {},
      create: {
        id: 'cust-3',
        name: 'Toko Sumber Rezeki',
        phone: '031-5554567',
        address: 'Jl. Pasar Baru No. 15, Surabaya',
        unitId: unit3.id
      }
    }),
    prisma.customer.upsert({
      where: { id: 'cust-4' },
      update: {},
      create: {
        id: 'cust-4',
        name: 'Restoran Nusantara',
        phone: '021-5557890',
        email: 'kitchen@restonanusantara.id',
        address: 'Jl. Kemang No. 88, Jakarta Selatan',
        unitId: unit1.id
      }
    })
  ]);

  console.log('✅ Customers created');

  // Create Settings
  await prisma.setting.upsert({
    where: { key: 'whatsapp_group' },
    update: {},
    create: {
      key: 'whatsapp_group',
      value: JSON.stringify({ groupId: '120363xxxxx@g.us' })
    }
  });

  await prisma.setting.upsert({
    where: { key: 'company_info' },
    update: {},
    create: {
      key: 'company_info',
      value: JSON.stringify({
        name: 'PT. Razkindo Jaya',
        address: 'Jl. Sudirman No. 123, Jakarta',
        phone: '021-1234567',
        email: 'info@razkindo.com'
      })
    }
  });

  console.log('✅ Settings created');

  // Create some sample transactions
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  // Transaction 1
  const trans1 = await prisma.transaction.create({
    data: {
      id: 'trx-1',
      type: 'sale',
      invoiceNo: 'INV-2025010001',
      unitId: unit1.id,
      createdById: sales1.id,
      customerId: customers[0].id,
      courierId: kurir1.id,
      total: 2400000,
      paidAmount: 2400000,
      remainingAmount: 0,
      totalHpp: 1600000,
      totalProfit: 800000,
      hppPaid: 1600000,
      profitPaid: 800000,
      hppUnpaid: 0,
      profitUnpaid: 0,
      status: 'paid',
      paymentStatus: 'paid',
      transactionDate: twoDaysAgo,
      items: {
        create: [
          {
            productId: 'prod-1',
            productName: 'Kopi Arabika Premium',
            qty: 10,
            price: 150000,
            hpp: 80000,
            subtotal: 1500000,
            profit: 700000
          },
          {
            productId: 'prod-3',
            productName: 'Gula Aren Murni',
            qty: 20,
            price: 45000,
            hpp: 45000,
            subtotal: 900000,
            profit: 0
          }
        ]
      }
    }
  });

  // Transaction 2
  const trans2 = await prisma.transaction.create({
    data: {
      id: 'trx-2',
      type: 'sale',
      invoiceNo: 'INV-2025010002',
      unitId: unit2.id,
      createdById: sales2.id,
      customerId: customers[1].id,
      total: 1850000,
      paidAmount: 500000,
      remainingAmount: 1350000,
      totalHpp: 1300000,
      totalProfit: 550000,
      hppPaid: 351351,
      profitPaid: 148649,
      hppUnpaid: 948649,
      profitUnpaid: 401351,
      status: 'approved',
      paymentStatus: 'partial',
      dueDate: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000),
      transactionDate: yesterday,
      items: {
        create: [
          {
            productId: 'prod-2',
            productName: 'Teh Hijau Organik',
            qty: 10,
            price: 85000,
            hpp: 65000,
            subtotal: 850000,
            profit: 200000
          },
          {
            productId: 'prod-4',
            productName: 'Madu Hutan Asli',
            qty: 10,
            price: 100000,
            hpp: 65000,
            subtotal: 1000000,
            profit: 350000
          }
        ]
      }
    }
  });

  // Transaction 3 - Pending
  const trans3 = await prisma.transaction.create({
    data: {
      id: 'trx-3',
      type: 'sale',
      invoiceNo: 'INV-2025010003',
      unitId: unit1.id,
      createdById: sales1.id,
      customerId: customers[3].id,
      total: 950000,
      paidAmount: 0,
      remainingAmount: 950000,
      totalHpp: 570000,
      totalProfit: 380000,
      hppPaid: 0,
      profitPaid: 0,
      hppUnpaid: 570000,
      profitUnpaid: 380000,
      status: 'pending',
      paymentStatus: 'unpaid',
      transactionDate: today,
      items: {
        create: [
          {
            productId: 'prod-5',
            productName: 'Cokelat Bubuk Premium',
            qty: 10,
            price: 95000,
            hpp: 57000,
            subtotal: 950000,
            profit: 380000
          }
        ]
      }
    }
  });

  console.log('✅ Sample transactions created');

  // Create events
  await prisma.event.createMany({
    data: [
      {
        type: 'transaction_created',
        payload: JSON.stringify({ transactionId: trans3.id, invoiceNo: trans3.invoiceNo })
      },
      {
        type: 'transaction_approved',
        payload: JSON.stringify({ transactionId: trans1.id, invoiceNo: trans1.invoiceNo })
      }
    ]
  });

  console.log('✅ Events created');

  console.log('🎉 Seed completed!');
  console.log('\n📝 Login credentials:');
  console.log('   Super Admin: admin@razkindo.com / admin123');
  console.log('   Sales Jakarta: sales.jkt@razkindo.com / admin123');
  console.log('   Sales Bandung: sales.bdg@razkindo.com / admin123');
  console.log('   Kurir Jakarta: kurir.jkt@razkindo.com / admin123');
  console.log('   Keuangan Jakarta: keuangan.jkt@razkindo.com / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
