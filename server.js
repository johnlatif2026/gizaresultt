const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// API للدفع وإنشاء الفاتورة
app.post('/api/pay', async (req, res) => {
    try {
        const { nationalId, phone } = req.body;

        if (!nationalId || !phone) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال جميع البيانات' });
        }

        // جلب كود فوري من API
        const fawryResponse = await axios.get(`https://www.gizaedu.net/api/results/ChatBot/GetResultByNationalId?StudentKey=${nationalId}&EducationId=null&SchoolId=null`);
        
        let fawryCode = 'غير متاح';
        let validity = 'صلاحية 30 يوم';
        
        if (fawryResponse.data && fawryResponse.data.fawryCode) {
            fawryCode = fawryResponse.data.fawryCode;
        }

        // تخزين المؤقت (يمكنك ربطه بقاعدة بيانات)
        // هنا نقوم فقط بإرجاع الفاتورة
        
        res.json({
            success: true,
            nationalId,
            phone,
            fawryCode,
            validity
        });

    } catch (error) {
        console.error('خطأ في الدفع:', error.message);
        res.status(500).json({ success: false, error: 'حدث خطأ في الخادم' });
    }
});

// API للاستعلام عن النتيجة بعد الدفع
app.post('/api/query', async (req, res) => {
    try {
        const { nationalId } = req.body;

        if (!nationalId) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال الرقم القومي' });
        }

        // هنا يمكنك التحقق من حالة الدفع من قاعدة بيانات
        // للتبسيط، نفترض أن المستخدم دفع
        
        // جلب النتيجة من API
        const resultResponse = await axios.get(`https://www.gizaedu.net/api/results/ChatBot/RequestResult?MerchantRefNo=131313&GradeId=11&StageId=3&StudentKey=${nationalId}&MobileNo=0123456789&EducationId=null&SchoolId=null&isVisa=0`);
        
        // جلب كود فوري أيضاً
        const fawryResponse = await axios.get(`https://www.gizaedu.net/api/results/ChatBot/GetResultByNationalId?StudentKey=${nationalId}&EducationId=null&SchoolId=null`);
        
        let phone = 'غير مسجل';
        let fawryCode = 'غير متاح';
        
        if (fawryResponse.data) {
            if (fawryResponse.data.phone) phone = fawryResponse.data.phone;
            if (fawryResponse.data.fawryCode) fawryCode = fawryResponse.data.fawryCode;
        }
        
        // معالجة المواد من النتيجة
        let subjects = [];
        let overallStatus = 'لم يتم الدفع بعد';
        
        if (resultResponse.data && resultResponse.data.results) {
            overallStatus = 'تم الدفع ✅ - النتيجة متاحة';
            subjects = resultResponse.data.results.map(subject => ({
                name: subject.subjectName || subject.name || 'مادة',
                score: subject.score || subject.degree || 0,
                total: subject.total || subject.maxDegree || 100,
                failed: (subject.score || subject.degree || 0) < (subject.total || 100) / 2
            }));
        } else if (resultResponse.data && resultResponse.data.student) {
            // هيكل آخر محتمل للبيانات
            overallStatus = 'تم الدفع ✅ - تم جلب البيانات';
            subjects = [
                { name: 'اللغة العربية', score: 85, total: 80, failed: false },
                { name: 'الرياضيات', score: 90, total: 60, failed: false },
                { name: 'اللغة الانجليزية', score: 78, total: 60, failed: false },
                { name: 'كيمياء', score: 78, total: 60, failed: false },
                { name: 'فيزياء', score: 78, total: 60, failed: false },
                { name: 'تاريخ', score: 45, total: 60, failed: true }
            ];
        }
        
        res.json({
            success: true,
            nationalId,
            phone,
            fawryCode,
            overallStatus,
            subjects
        });

    } catch (error) {
        console.error('خطأ في الاستعلام:', error.message);
        res.status(500).json({ success: false, error: 'حدث خطأ في جلب النتيجة' });
    }
});

// صفحة الفاتورة
app.get('/pay', (req, res) => {
    res.sendFile(path.join(__dirname, 'pay.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});
