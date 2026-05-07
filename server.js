const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// تخزين الفواتير في الذاكرة (يفضل استخدام قاعدة بيانات في الإنتاج)
const invoices = new Map();

// Helper function للاستدعاءات مع retry mechanism
async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            return response;
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// 1. إنشاء فاتورة جديدة - جلب كود فوري من الـ API الرسمي
app.post('/api/create-invoice', async (req, res) => {
    const { nationalId, phone } = req.body;
    
    // التحقق من صحة البيانات
    if (!nationalId || !phone) {
        return res.status(400).json({ 
            success: false, 
            message: 'الرجاء إدخال الرقم القومي ورقم الهاتف' 
        });
    }
    
    if (nationalId.length !== 14) {
        return res.status(400).json({ 
            success: false, 
            message: 'الرقم القومي يجب أن يكون 14 رقم' 
        });
    }
    
    try {
        // جلب كود فوري من API الرسمي
        const fawryResponse = await fetchWithRetry(
            `https://www.gizaedu.net/api/results/ChatBot/GetResultByNationalId?StudentKey=${nationalId}&EducationId=null&SchoolId=null`
        );
        
        const fawryCode = fawryResponse.data;
        
        if (!fawryCode) {
            throw new Error('لم يتم استلام كود فوري');
        }
        
        const invoiceId = uuidv4();
        
        const invoice = {
            id: invoiceId,
            nationalId,
            phone,
            fawryCode,
            paid: false,
            amount: 25,
            currency: 'EGP',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // صلاحية 24 ساعة
        };
        
        invoices.set(invoiceId, invoice);
        
        // تسجيل العملية
        console.log(`[INFO] تم إنشاء فاتورة جديدة: ${invoiceId} للرقم القومي: ${nationalId}`);
        
        res.json({ 
            success: true, 
            invoiceId,
            message: 'تم إنشاء الفاتورة بنجاح'
        });
        
    } catch (error) {
        console.error('[ERROR] فشل في إنشاء الفاتورة:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'عذراً، حدث خطأ في الاتصال بخدمة فوري. يرجى المحاولة لاحقاً.'
        });
    }
});

// 2. الحصول على بيانات الفاتورة
app.get('/api/get-invoice/:id', (req, res) => {
    const invoice = invoices.get(req.params.id);
    
    if (invoice) {
        // التحقق من صلاحية الفاتورة
        const isExpired = new Date(invoice.expiresAt) < new Date();
        
        res.json({ 
            success: true, 
            invoice: {
                ...invoice,
                isExpired
            }
        });
    } else {
        res.status(404).json({ 
            success: false, 
            message: 'الفاتورة غير موجودة' 
        });
    }
});

// 3. التحقق من حالة الدفع من خلال API فوري
app.post('/api/check-payment/:id', async (req, res) => {
    const invoice = invoices.get(req.params.id);
    
    if (!invoice) {
        return res.status(404).json({ 
            success: false, 
            message: 'الفاتورة غير موجودة' 
        });
    }
    
    // التحقق من صلاحية الفاتورة
    if (new Date(invoice.expiresAt) < new Date()) {
        return res.json({ 
            paid: false, 
            expired: true,
            message: 'انتهت صلاحية الفاتورة. يرجى إنشاء فاتورة جديدة.'
        });
    }
    
    try {
        const checkPaymentUrl = `https://www.gizaedu.net/api/results/ChatBot/CheckPayment?ReferenceNumber=${invoice.fawryCode}`;
        
        const paymentResponse = await fetchWithRetry(checkPaymentUrl).catch(() => null);
        
        if (paymentResponse && paymentResponse.data) {
            const isPaid = paymentResponse.data.status === 'PAID';
            
            if (isPaid && !invoice.paid) {
                // تحديث حالة الدفع
                invoice.paid = true;
                invoice.paidAt = new Date().toISOString();
                invoices.set(req.params.id, invoice);
                
                console.log(`[INFO] تم تأكيد الدفع للفاتورة: ${req.params.id}`);
            }
            
            return res.json({ 
                paid: invoice.paid,
                expired: false,
                paymentDetails: paymentResponse.data
            });
        }
        
        // إذا لم نتمكن من التحقق من API، نرجع الحالة المخزنة
        return res.json({ 
            paid: invoice.paid,
            expired: false,
            message: 'جاري التحقق من الدفع...'
        });
        
    } catch (error) {
        console.error('[ERROR] فشل التحقق من الدفع:', error.message);
        res.status(500).json({ 
            paid: false,
            error: true,
            message: 'حدث خطأ في التحقق من الدفع. يرجى المحاولة لاحقاً.'
        });
    }
});

// 4. الاستعلام عن النتيجة بعد الدفع
app.post('/api/query-result', async (req, res) => {
    const { nationalId } = req.body;
    
    if (!nationalId) {
        return res.status(400).json({ 
            success: false, 
            message: 'الرجاء إدخال الرقم القومي' 
        });
    }
    
    try {
        // البحث عن فاتورة مدفوعة لهذا الرقم القومي
        let paidInvoice = null;
        for (let [key, value] of invoices) {
            if (value.nationalId === nationalId && value.paid === true) {
                paidInvoice = value;
                break;
            }
        }
        
        if (!paidInvoice) {
            return res.status(402).json({ 
                success: false, 
                message: 'لم تقم بالدفع بعد. يرجى الدفع أولاً للاستعلام عن النتيجة',
                requiresPayment: true
            });
        }
        
        // جلب النتيجة من API الرسمي
        const resultResponse = await fetchWithRetry(
            `https://www.gizaedu.net/api/results/ChatBot/RequestResult?MerchantRefNo=131313&GradeId=11&StageId=3&StudentKey=${nationalId}&MobileNo=${paidInvoice.phone}&EducationId=null&SchoolId=null&isVisa=0`
        );
        
        const studentData = resultResponse.data;
        
        if (!studentData) {
            throw new Error('لم يتم العثور على بيانات الطالب');
        }
        
        // معالجة المواد الدراسية من البيانات المستلمة
        const subjects = [];
        let overallPassed = true;
        
        // معالجة المواد - حسب هيكل البيانات القادم من API
        if (studentData.subjects && Array.isArray(studentData.subjects)) {
            studentData.subjects.forEach(subject => {
                subjects.push({
                    name: subject.name || subject.subjectName,
                    score: subject.score || subject.degree || 0,
                    maxScore: subject.maxScore || subject.fullDegree || 100,
                    passed: subject.status === 'PASS' || subject.passed === true || subject.isSuccess === true,
                    grade: subject.grade || null
                });
                
                if (!subject.passed && subject.passed !== undefined) {
                    overallPassed = false;
                }
            });
        } else {
            // إذا كانت البيانات في تنسيق مختلف
            return res.status(500).json({
                success: false,
                message: 'تنسيق البيانات غير متوافق'
            });
        }
        
        const result = {
            nationalId,
            phone: paidInvoice.phone,
            studentName: studentData.studentName || studentData.name || 'غير محدد',
            academicYear: studentData.academicYear || '2024/2025',
            schoolName: studentData.schoolName || studentData.school || 'غير محدد',
            subjects,
            overallPassed,
            totalScore: subjects.reduce((sum, s) => sum + s.score, 0),
            totalMaxScore: subjects.reduce((sum, s) => sum + s.maxScore, 0),
            percentage: (subjects.reduce((sum, s) => sum + s.score, 0) / subjects.reduce((sum, s) => sum + s.maxScore, 0) * 100).toFixed(2),
            queryDate: new Date().toISOString()
        };
        
        // تخزين النتيجة مؤقتاً
        const resultId = uuidv4();
        invoices.set(resultId, { ...paidInvoice, result, type: 'result' });
        
        console.log(`[INFO] تم جلب النتيجة للطالب: ${nationalId}`);
        
        res.json({ 
            success: true, 
            invoiceId: resultId,
            result
        });
        
    } catch (error) {
        console.error('[ERROR] فشل في جلب النتيجة:', error.message);
        
        if (error.response && error.response.status === 404) {
            res.status(404).json({ 
                success: false, 
                message: 'لم يتم العثور على بيانات للرقم القومي المدخل'
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'حدث خطأ في جلب النتيجة. يرجى المحاولة لاحقاً.'
            });
        }
    }
});

// 5. الحصول على النتيجة المخزنة
app.get('/api/get-result/:id', (req, res) => {
    const data = invoices.get(req.params.id);
    
    if (data && data.result) {
        res.json({ 
            success: true, 
            paid: true,
            result: data.result
        });
    } else if (data && !data.paid) {
        res.json({ 
            success: false, 
            paid: false,
            message: 'لم يتم الدفع بعد'
        });
    } else {
        res.status(404).json({ 
            success: false, 
            message: 'النتيجة غير موجودة'
        });
    }
});

// 6. Endpoint للتحقق من صحة الرقم القومي
app.post('/api/validate-national-id', async (req, res) => {
    const { nationalId } = req.body;
    
    if (!nationalId || nationalId.length !== 14) {
        return res.json({ 
            valid: false, 
            message: 'الرقم القومي يجب أن يكون 14 رقم' 
        });
    }
    
    try {
        // التحقق من وجود الطالب في النظام
        const checkResponse = await fetchWithRetry(
            `https://www.gizaedu.net/api/results/ChatBot/GetResultByNationalId?StudentKey=${nationalId}&EducationId=null&SchoolId=null`
        );
        
        res.json({ 
            valid: true,
            exists: true,
            message: 'الرقم القومي صحيح'
        });
    } catch (error) {
        res.json({ 
            valid: false,
            exists: false, 
            message: 'الرقم القومي غير موجود في النظام'
        });
    }
});

// 7. إحصائيات النظام (للمسؤول)
app.get('/api/stats', (req, res) => {
    const totalInvoices = invoices.size;
    const paidInvoices = Array.from(invoices.values()).filter(inv => inv.paid === true).length;
    const pendingInvoices = totalInvoices - paidInvoices;
    
    res.json({
        totalInvoices,
        paidInvoices,
        pendingInvoices,
        totalRevenue: paidInvoices * 25
    });
});

// معالجة الأخطاء العامة
app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ 
        success: false, 
        message: 'حدث خطأ داخلي في الخادم' 
    });
});

app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`📱 الواجهة: http://localhost:${PORT}`);
    console.log(`🎓 نظام الاستعلام عن النتائج - النسخة الرسمية`);
});
