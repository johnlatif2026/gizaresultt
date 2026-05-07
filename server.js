const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));

app.post("/api/payment-code", async (req,res)=>{

try{

const {nationalId} = req.body;

const response = await axios.get(
`https://www.gizaedu.net/api/results/ChatBot/GetResultByNationalId?StudentKey=${nationalId}&EducationId=null&SchoolId=null`
);

res.json({
code: response.data?.Data || "غير متوفر"
});

}catch(err){

res.json({
error:"حدث خطأ"
});

}

});

app.post("/api/result", async (req,res)=>{

try{

const {nationalId} = req.body;

const resultData = {

nationalId,

name:"اسم الطالب",

isSupplement:false,

subjects:[

{
name:"اللغة العربية",
degree:"70/80",
supplement:false
},

{
name:"الرياضيات",
degree:"55/60",
supplement:false
},

{
name:"اللغة الإنجليزية",
degree:"38/40",
supplement:false
},

  {
    name:"كيمياء"
    degree:"38/40"
    supplement:"false"
  },

           {
    name:"فيزياء"
    degree:"38/40"
    supplement:"false"
  },
{
name:"التاريخ",
degree:"18/20",
supplement:false
}

]

};

res.json(resultData);

}catch(err){

res.json({
error:"حدث خطأ"
});

}

});

app.get("*",(req,res)=>{

res.sendFile(
path.join(__dirname,"index.html")
);

});

const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{

console.log("Server Running");

});
