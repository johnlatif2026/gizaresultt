const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// تخزين مؤقت للبيانات بين الدفع والاستعلام
const paymentSessions = new Map();

// مواد المجموع (المواد المضافة للمجموع الكلي)
const mainSubjects = [
    { name: 'اللغة العربية', total: 80, pass: 40, isMain: true },
    { name: 'الرياضيات', total: 60, pass: 30, isMain: true },
    { name: 'اللغة الإنجليزية', total: 60, pass: 30, isMain: true },
    { name: 'الكيمياء', total: 60, pass: 30, isMain: true },
    { name: 'الفيزياء', total: 60, pass: 30, isMain: true },
    { name: 'التاريخ', total: 60, pass: 30, isMain: true }
];

// المواد غير المضافة للمجموع (نجاح/رسوب فقط)
const secondarySubjects = [
    { name: 'التربية الوطنية', total: 40, pass: 20, isMain: false },
    { name: 'التربية الدينية', total: 40, pass: 20, isMain: false },
    { name: 'التربية المهنية', total: 40, pass: 20, isMain: false },
    { name: 'اللغة الأجنبية الثانية', total: 40, pass: 20, isMain: false }
];

// دالة لاستخراج درجات الطالب من الـ API
function extractScoresFromApi(apiData) {
    const scores = {};
    
    if (!apiData) return scores;
    
    // محاولة استخراج الدرجات من صيغ مختلفة للـ API
    const dataStr = JSON.stringify(apiData).toLowerCase();
    
    // قائمة المواد بالعربي
    const subjectNames = {
        'اللغة العربية': ['العربية', 'عربي', 'اللغة العربية', 'arabic', 'lang_ar'],
        'الرياضيات': ['رياضيات', 'رياضة', 'ماث', 'math', 'mathematics'],
        'اللغة الإنجليزية': ['الإنجليزية', 'انجليزي', 'english', 'lang_en'],
        'الكيمياء': ['كيمياء', 'chemistry', 'chem'],
        'الفيزياء': ['فيزياء', 'physics', 'phys'],
        'التاريخ': ['تاريخ', 'history'],
        'التربية الوطنية': ['وطنية', 'تربية وطنية', 'national'],
        'التربية الدينية': ['دينية', 'تربية دينية', 'religious', 'islamic'],
        'التربية المهنية': ['مهنية', 'تربية مهنية', 'professional'],
        'اللغة الأجنبية الثانية': ['اجنبية', 'لغة ثانية', 'second language', 'french', 'german']
    };
    
    // البحث في بيانات API
    for (const [subjectName, keywords] of Object.entries(subjectNames)) {
        let score = null;
        
        // البحث المباشر في الكائن
        for (const key of Object.keys(apiData)) {
            const keyLower = key.toLowerCase();
            if (keywords.some(kw => keyLower.includes(kw))) {
                const value = apiData[key];
                if (typeof value === 'number') {
                    score = value;
                    break;
                } else if (typeof value === 'string' && !isNaN(parseFloat(value))) {
                    score = parseFloat(value);
                    break;
                }
            }
        }
        
        // البحث في النص الكامل
        if (score === null) {
            for (const kw of keywords) {
                const regex = new RegExp(`${kw}[^0-9]*([0-9]+(?:\\.[0-9]+)?)`, 'i');
                const match = dataStr.match(regex);
                if (match) {
                    score = parseFloat(match[1]);
                    break;
                }
            }
        }
        
        if (score !== null) {
            scores[subjectName] = score;
        }
    }
    
    return scores;
}

// API للدفع - يجلب كود فوري فقط
app.post('/api/pay', async (req, res) => {
    try {
        const { nationalId, phone } = req.body;

        if (!nationalId || !phone) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال جميع البيانات' });
        }

        console.log(`💰 دفع للرقم القومي: ${nationalId}, هاتف: ${phone}`);
        
        let fawryCode = 'غير متاح';
        let validity = 'غير محدد';
        let studentName = '';
        let rawResponse = null;
        
        // جلب كود فوري من API
        const apiUrl = `https://www.gizaedu.net/api/results/ChatBot/GetResultByNationalId?StudentKey=${nationalId}&EducationId=null&SchoolId=null`;
        console.log(`📡 استدعاء: ${apiUrl}`);
        
        try {
            const response = await axios.get(apiUrl, {
                timeout: 15000,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            
            rawResponse = response.data;
            console.log('✅ تم استلام الرد');
            
            // استخراج كود فوري - بكل الصيغ الممكنة
            fawryCode = rawResponse?.fawryCode || 
                       rawResponse?.FawryCode || 
                       rawResponse?.code || 
                       rawResponse?.Code ||
                       rawResponse?.paymentCode ||
                       rawResponse?.transactionId ||
                       rawResponse?.id ||
                       'فشل استخراج الكود';
            
            // استخراج الصلاحية
            validity = rawResponse?.validity || 
                      rawResponse?.Validaty ||
                      rawResponse?.expiryDate ||
                      rawResponse?.expiration ||
                      rawResponse?.valid_until ||
                      'صلاحية 30 يوم';
            
            // استخراج اسم الطالب
            studentName = rawResponse?.studentName || 
                         rawResponse?.name ||
                         rawResponse?.StudentName ||
                         rawResponse?.fullName ||
                         '';
                         
        } catch (apiError) {
            console.error('❌ فشل الاتصال بـ API:', apiError.message);
            if (apiError.response) {
                console.error('رد الخطأ:', apiError.response.status, apiError.response.data);
            }
            fawryCode = `خطأ: فشل الاتصال بالخادم`;
            validity = 'غير متاحة حالياً';
        }
        
        // تخزين جلسة الدفع
        paymentSessions.set(nationalId, {
            phone: phone,
            fawryCode: fawryCode,
            validity: validity,
            paidAt: new Date().toISOString(),
            studentName: studentName,
            apiResponse: rawResponse
        });
        
        // تنظيف الجلسات القديمة (أكثر من ساعة)
        setTimeout(() => {
            paymentSessions.delete(nationalId);
        }, 3600000);
        
        res.json({
            success: true,
            nationalId: nationalId,
            phone: phone,
            fawryCode: fawryCode,
            validity: validity,
            studentName: studentName
        });

    } catch (error) {
        console.error('💥 خطأ:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API للاستعلام عن النتيجة - فقط بعد الدفع
app.post('/api/query', async (req, res) => {
    try {
        const { nationalId } = req.body;

        if (!nationalId) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال الرقم القومي' });
        }
        
        // التحقق من دفع الطالب
        const paymentSession = paymentSessions.get(nationalId);
        if (!paymentSession) {
            return res.status(403).json({ 
                success: false, 
                error: '⚠️ لم تقم بالدفع بعد. يرجى الدفع أولاً للاستعلام عن النتيجة' 
            });
        }
        
        console.log(`🔍 استعلام عن نتيجة الرقم القومي: ${nationalId} (مدفوع)`);
        
        let studentData = null;
        let scoresFromApi = {};
        
        // جلب النتيجة من API
        const phone = paymentSession.phone;
        const resultApiUrl = `https://www.gizaedu.net/api/results/ChatBot/RequestResult?MerchantRefNo=131313&GradeId=11&StageId=3&StudentKey=${nationalId}&MobileNo=${phone}&EducationId=null&SchoolId=null&isVisa=0`;
        console.log(`📡 استدعاء API النتائج: ${resultApiUrl}`);
        
        try {
            const resultResponse = await axios.get(resultApiUrl, {
                timeout: 15000,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            
            studentData = resultResponse.data;
            console.log('✅ تم استلام بيانات النتيجة');
            console.log('البيانات:', JSON.stringify(studentData).substring(0, 500));
            
            // استخراج الدرجات من API
            scoresFromApi = extractScoresFromApi(studentData);
            console.log('الدرجات المستخرجة:', scoresFromApi);
            
        } catch (resultError) {
            console.error('❌ فشل جلب النتيجة:', resultError.message);
            if (resultError.response) {
                console.error('رد الخطأ:', resultError.response.status, resultError.response.data);
            }
            return res.status(500).json({ 
                success: false, 
                error: `فشل جلب النتيجة من الخادم: ${resultError.message}` 
            });
        }
        
        // بناء النتائج من الدرجات المستخرجة
        const results = [];
        let totalScore = 0;
        let totalPossible = 0;
        let hasFailed = false;
        
        // معالجة المواد المضافة للمجموع
        for (const subject of mainSubjects) {
            let score = scoresFromApi[subject.name];
            
            // إذا لم توجد الدرجة من API، نرجع خطأ
            if (score === undefined) {
                return res.status(500).json({
                    success: false,
                    error: `لم يتم العثور على درجة مادة ${subject.name} من الخادم. البيانات المستلمة: ${JSON.stringify(studentData)}`
                });
            }
            
            const isPassed = score >= subject.pass;
            const failed = !isPassed;
            
            if (failed) {
                hasFailed = true;
            }
            
            totalScore += score;
            totalPossible += subject.total;
            
            results.push({
                name: subject.name,
                score: score,
                total: subject.total,
                pass: subject.pass,
                failed: failed,
                isMain: true,
                status: failed ? '❌ ملحق' : '✅ نجاح'
            });
        }
        
        // معالجة المواد غير المضافة للمجموع
        const secondaryResults = [];
        let secondaryFailed = [];
        
        for (const subject of secondarySubjects) {
            let score = scoresFromApi[subject.name];
            
            if (score === undefined) {
                return res.status(500).json({
                    success: false,
                    error: `لم يتم العثور على درجة مادة ${subject.name} من الخادم. البيانات المستلمة: ${JSON.stringify(studentData)}`
                });
            }
            
            const isPassed = score >= subject.pass;
            const failed = !isPassed;
            
            if (failed) {
                secondaryFailed.push(subject.name);
            }
            
            secondaryResults.push({
                name: subject.name,
                score: score,
                total: subject.total,
                pass: subject.pass,
                failed: failed,
                isMain: false,
                status: failed ? '❌ ملحق' : '✅ نجاح'
            });
        }
        
        const totalPercentage = totalPossible > 0 ? ((totalScore / totalPossible) * 100).toFixed(2) : 0;
        
        let overallStatus = '';
        if (hasFailed) {
            overallStatus = '⚠️ غير ناجح - يوجد مواد ملحق (مادة أو أكثر أقل من نصف الدرجة)';
        } else {
            overallStatus = `✅ ناجح - المجموع: ${totalScore}/${totalPossible} (${totalPercentage}%)`;
        }
        
        res.json({
            success: true,
            nationalId: nationalId,
            studentName: paymentSession.studentName || '',
            overallStatus: overallStatus,
            totalScore: totalScore,
            totalPossible: totalPossible,
            totalPercentage: totalPercentage,
            hasFailed: hasFailed,
            mainSubjects: results,
            secondarySubjects: secondaryResults,
            secondaryFailed: secondaryFailed
        });

    } catch (error) {
        console.error('💥 خطأ:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// صفحة الفاتورة - تستقبل البيانات من Query Parameters
app.get('/pay', (req, res) => {
    res.sendFile(path.join(__dirname, 'pay.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
    console.log('=' .repeat(50));
    console.log('📚 المواد المضافة للمجموع:');
    mainSubjects.forEach(s => console.log(`   - ${s.name}: ${s.total} درجة (النجاح: ${s.pass})`));
    console.log('📚 المواد غير المضافة للمجموع:');
    secondarySubjects.forEach(s => console.log(`   - ${s.name}: ${s.total} درجة (النجاح: ${s.pass})`));
    console.log('=' .repeat(50));
});
