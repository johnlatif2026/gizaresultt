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
        'الرياضيات': ['رياضيات', 'رياضة', 'رياضيات', 'math', 'mathematics'],
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

// API للدفع - يجلب كود فوري فقط ويحول للفاتورة
app.post('/api/pay', async (req, res) => {
    try {
        const { nationalId, phone } = req.body;

        if (!nationalId || !phone) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال جميع البيانات' });
        }

        console.log(`💰 دفع للرقم القومي: ${nationalId}, هاتف: ${phone}`);
        
        let fawryCode = 'غير متاح';
        let validity = 'غير محدد';
        let apiSuccess = false;
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
            apiSuccess = true;
            console.log('✅ تم استلام الرد');
            
            // استخراج كود فوري
            fawryCode = rawResponse?.fawryCode || 
                       rawResponse?.FawryCode || 
                       rawResponse?.code || 
                       rawResponse?.paymentCode ||
                       rawResponse?.transactionId ||
                       'فشل استخراج الكود';
            
            // استخراج الصلاحية
            validity = rawResponse?.validity || 
                      rawResponse?.expiryDate ||
                      rawResponse?.expiration ||
                      'صلاحية 30 يوم';
            
            // استخراج اسم الطالب
            studentName = rawResponse?.studentName || 
                         rawResponse?.name ||
                         rawResponse?.StudentName ||
                         '';
                         
        } catch (apiError) {
            console.error('❌ فشل الاتصال بـ API:', apiError.message);
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
        let apiSuccess = false;
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
            apiSuccess = true;
            console.log('✅ تم استلام بيانات النتيجة');
            
            // استخراج الدرجات من API
            scoresFromApi = extractScoresFromApi(studentData);
            
        } catch (resultError) {
            console.error('❌ فشل جلب النتيجة:', resultError.message);
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
                    error: `لم يتم العثور على درجة مادة ${subject.name} من الخادم`,
                    apiDataReceived: studentData
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
                    error: `لم يتم العثور على درجة مادة ${subject.name} من الخادم`,
                    apiDataReceived: studentData
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
        
        // فصل المواد المضافة وغير المضافة
        const mainResults = results;
        
        res.json({
            success: true,
            nationalId: nationalId,
            studentName: paymentSession.studentName || '',
            overallStatus: overallStatus,
            totalScore: totalScore,
            totalPossible: totalPossible,
            totalPercentage: totalPercentage,
            hasFailed: hasFailed,
            mainSubjects: mainResults,
            secondarySubjects: secondaryResults,
            secondaryFailed: secondaryFailed
        });

    } catch (error) {
        console.error('💥 خطأ:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// صفحة الفاتورة - فقط لمن دفع ويحمل البيانات
app.get('/pay.html', (req, res) => {
    const { nationalId, phone, fawryCode, validity } = req.query;
    
    if (!nationalId || !phone) {
        return res.send(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head><meta charset="UTF-8"><title>خطأ</title>
            <style>body{font-family:Tahoma;text-align:center;padding:50px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;} .error{background:white;color:#dc3545;padding:30px;border-radius:20px;max-width:500px;margin:auto;}</style>
            </head>
            <body>
                <div class="error">
                    <h1>❌ خطأ</h1>
                    <p>لا يمكن الوصول إلى هذه الصفحة مباشرة.</p>
                    <a href="/" style="color:#667eea;">العودة للرئيسية</a>
                </div>
            </body>
            </html>
        `);
    }
    
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>فاتورة الدفع - نظام النتائج</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Tahoma', 'Arial', sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px;
                }
                .invoice-container {
                    max-width: 550px;
                    width: 100%;
                    background: white;
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.2);
                }
                h1 {
                    color: #667eea;
                    text-align: center;
                    margin-bottom: 30px;
                    font-size: 2em;
                }
                .invoice-header {
                    text-align: center;
                    margin-bottom: 30px;
                    padding-bottom: 20px;
                    border-bottom: 2px solid #e0e0e0;
                }
                .row {
                    display: flex;
                    justify-content: space-between;
                    padding: 15px 0;
                    border-bottom: 1px solid #f0f0f0;
                }
                .row .label {
                    font-weight: bold;
                    color: #555;
                }
                .row .value {
                    color: #333;
                    font-weight: bold;
                }
                .status {
                    background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
                    color: white;
                    padding: 15px;
                    border-radius: 10px;
                    text-align: center;
                    margin: 20px 0;
                    font-weight: bold;
                }
                .back-btn {
                    display: inline-block;
                    width: 100%;
                    padding: 12px;
                    background: #667eea;
                    color: white;
                    text-align: center;
                    text-decoration: none;
                    border-radius: 10px;
                    margin-top: 20px;
                    font-weight: bold;
                    transition: opacity 0.3s;
                    border: none;
                    cursor: pointer;
                }
                .back-btn:hover { opacity: 0.9; }
                .fawry-code {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 10px;
                    text-align: center;
                    font-size: 1.3em;
                    letter-spacing: 3px;
                    font-weight: bold;
                    color: #667eea;
                    font-family: monospace;
                }
            </style>
        </head>
        <body>
            <div class="invoice-container">
                <h1>🧾 فاتورة الدفع</h1>
                <div class="invoice-header">
                    <h3>نظام الاستعلام عن النتيجة</h3>
                </div>
                <div class="row">
                    <span class="label">📇 الرقم القومي:</span>
                    <span class="value">${encodeURIComponent(nationalId)}</span>
                </div>
                <div class="row">
                    <span class="label">📞 رقم الهاتف:</span>
                    <span class="value">${encodeURIComponent(phone)}</span>
                </div>
                <div class="row">
                    <span class="label">🔑 كود فوري:</span>
                    <span class="value fawry-code">${encodeURIComponent(fawryCode)}</span>
                </div>
                <div class="row">
                    <span class="label">⏰ الصلاحية:</span>
                    <span class="value">${encodeURIComponent(validity)}</span>
                </div>
                <div class="status">
                    ✅ تم إنشاء الفاتورة بنجاح
                </div>
                <button onclick="window.location.href='/'" class="back-btn">🏠 العودة للرئيسية</button>
            </div>
        </body>
        </html>
    `);
});

// منع الوصول المباشر للملفات
app.get('/pay.html', (req, res) => {
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});
