const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// تخزين الفواتير مؤقتاً (في التطبيق الحقيقي استخدم قاعدة بيانات)
const invoices = new Map();

// إنشاء فاتورة جديدة
app.post('/api/create-invoice', async (req, res) => {
    const { nationalId, phone } = req.body;
    
    try {
        // جلب كود فوري من API
        const fawryResponse = await axios.get(
            `https://www.gizaedu.net/api/results/ChatBot/GetResultByNationalId?StudentKey=${nationalId}&EducationId=null&SchoolId=null`
        );
        
        const fawryCode = fawryResponse.data || '123456';
        const invoiceId = uuidv4();
        
        const invoice = {
            id: invoiceId,
            nationalId,
            phone,
            fawryCode,
            paid: false,
            createdAt: new Date()
        };
        
        invoices.set(invoiceId, invoice);
        
        res.json({ success: true, invoiceId });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.json({ success: false, message: 'فشل في إنشاء الفاتورة' });
    }
});

// الحصول على بيانات الفاتورة
app.get('/api/get-invoice/:id', (req, res) => {
    const invoice = invoices.get(req.params.id);
    
    if (invoice) {
        res.json({ success: true, invoice });
    } else {
        res.json({ success: false, message: 'الفاتورة غير موجودة' });
    }
});

// التحقق من حالة الدفع
app.post('/api/check-payment/:id', async (req, res) => {
    const invoice = invoices.get(req.params.id);
    
    if (!invoice) {
        return res.json({ success: false, message: 'الفاتورة غير موجودة' });
    }
    
    // هنا يمكن إضافة منطق التحقق من الدفع من خلال API فوري
    // حالياً نقوم بمحاكاة الدفع
    
    res.json({ paid: invoice.paid });
});

// الاستعلام عن النتيجة
app.post('/api/query-result', async (req, res) => {
    const { nationalId } = req.body;
    
    try {
        // التحقق مما إذا كان الطالب قد دفع
        let existingInvoice = null;
        for (let [key, value] of invoices) {
            if (value.nationalId === nationalId && value.paid) {
                existingInvoice = value;
                break;
            }
        }
        
        if (!existingInvoice) {
            // إنشاء فاتورة جديدة للمستخدم غير الدافع
            return res.json({ 
                success: false, 
                message: 'لم تقم بالدفع بعد. الرجاء الدفع أولاً' 
            });
        }
        
        // جلب النتيجة من API
        const resultResponse = await axios.get(
            `https://www.gizaedu.net/api/results/ChatBot/RequestResult?MerchantRefNo=131313&GradeId=11&StageId=3&StudentKey=${nationalId}&MobileNo=${existingInvoice.phone}&EducationId=null&SchoolId=null&isVisa=0`
        );
        
        const studentResult = resultResponse.data;
        
        // معالجة البيانات وعرض المواد
        const subjects = [];
        let overallPassed = true;
        
        // مثال على المواد - يمكن تعديلها حسب البيانات الفعلية من API
        const mockSubjects = [
            { name: 'اللغة العربية', score: 85, maxScore: 100, passed: true },
            { name: 'اللغة الإنجليزية', score: 78, maxScore: 100, passed: true },
            { name: 'الرياضيات', score: 92, maxScore: 100, passed: true },
            { name: 'العلوم', score: 88, maxScore: 100, passed: true },
            { name: 'الدراسات الاجتماعية', score: 75, maxScore: 100, passed: true }
        ];
        
        // إذا كان هناك بيانات حقيقية من API، استخدمها
        if (studentResult && studentResult.subjects) {
            subjects.push(...studentResult.subjects);
        } else {
            subjects.push(...mockSubjects);
        }
        
        const result = {
            nationalId,
            phone: existingInvoice.phone,
            academicYear: '2025/2026',
            subjects,
            overallPassed
        };
        
        // حفظ النتيجة مؤقتاً
        const resultId = uuidv4();
        invoices.set(resultId, { ...existingInvoice, result });
        
        res.json({ success: true, invoiceId: resultId });
        
    } catch (error) {
        console.error('Error querying result:', error);
        res.json({ success: false, message: 'فشل في جلب النتيجة' });
    }
});

// الحصول على النتيجة
app.get('/api/get-result/:id', (req, res) => {
    const data = invoices.get(req.params.id);
    
    if (data && data.paid && data.result) {
        res.json({ success: true, paid: true, result: data.result });
    } else if (data && !data.paid) {
        res.json({ success: true, paid: false });
    } else {
        res.json({ success: false, message: 'النتيجة غير موجودة' });
    }
});

// محاكاة الدفع (للتجربة)
app.post('/api/simulate-payment/:id', (req, res) => {
    const invoice = invoices.get(req.params.id);
    
    if (invoice) {
        invoice.paid = true;
        invoices.set(req.params.id, invoice);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
