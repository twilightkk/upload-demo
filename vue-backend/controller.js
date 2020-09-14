const path = require('path')
const fse = require("fs-extra");
const UPLOAD_DIR = path.resolve(__dirname,"..","target")
const multiparty = require('multiparty');
const extractExt = filename=>
  filename.slice(filename.lastIndexOf("."),filename.length)

const pipeStream = (path, writeStream) =>
  new Promise(resolve => {
    const readStream = fse.createReadStream(path);
    readStream.on('end', () => {
      resolve();
    });
    readStream.pipe(writeStream);
  })

  
const mergeFileChunk =async (filePath,fileHash,size)=>{
  const chunkDir = path.resolve(UPLOAD_DIR,fileHash)
  const chunkPaths =await fse.readdir(chunkDir)
  chunkPaths.sort((a, b) => a.split('-')[1] - b.split('-')[1])
  await Promise.all(
    chunkPaths.map((chunkPath,index)=>{
      pipeStream(
        path.resolve(chunkDir,chunkPath),
        fse.createWriteStream(filePath,{
          start:index*size,
          end: (index + 1) * size
        })
      )
    })
  )
}

const resolvePost = req =>
  new Promise(resolve => {
    let chunk = "";
    req.on("data", data => {
      chunk += data;  //二进制
    })
    req.on("end", () => {
      console.log('end', chunk);
      resolve(JSON.parse(chunk))
    })
  })


module.exports=class{
  async handleVerifyUpload(req,res){
    // res.end('verify')
    
    const data = await resolvePost(req)
    // console.log('data',data);
    
    const { fileHash, filename}=data
    const ext =extractExt(filename)
    console.log('ext',ext)
    const filePath = path.resolve(UPLOAD_DIR,`${fileHash}${ext}`);
    console.log('filePath',filePath);
    if(fse.existsSync(filePath)){
      res.end(
        JSON.stringify({
          shouldUpload:false
        })
      )
    }else{
      res.end(
        JSON.stringify({
          shouldUpload:true,
          uploadedList:[]
        })
      )
    }
    
  }
  async handleFormData(req,res){
    const multipart= new multiparty.Form()
    multipart.parse(req,async(err,fields,files)=>{
      if(err){
        // console.log(err);
        res.statusCode=500
        res.end('process file chunk failed')
        return ;
      }
      // 随机报错
      if(Math.random()<0.5){
        res.statusCode= 500
        res.end('network error===============')
        return ;
      }
      console.log(fields);
      console.log(files);
      
      const [chunk] = files.chunk
      const [hash] = fields.hash
      const [fileHash] = fields.fileHash
      const [filename] = fields.filename
      console.log(chunk, hash,fileHash,filename);
      const filePath = path.resolve(UPLOAD_DIR,`${fileHash}${extractExt(filename)}`)
      // console.log(filePath);
      
      const chunkDir= path.resolve(UPLOAD_DIR,fileHash)

      if(fse.existsSync(filePath)){
        res.end('file exist')
        return 
      }
      if(!fse.existsSync(chunkDir)){
        // 如果没有target
        await fse.mkdirs(chunkDir)
      }
      await fse.move(chunk.path,path.resolve(chunkDir,hash))
      res.end('received file chunk')
      
    })
  }
  async handleMerge(req,res){
    const data = await resolvePost(req)
    const {fileHash, filename, size} = data
    const ext = extractExt(filename)
    const filePath = path.resolve(UPLOAD_DIR,`${fileHash}${ext}`)
    console.log(filePath);
    await mergeFileChunk(filePath, fileHash , size)
    res.end(
      JSON.stringify({
        code:0,
        message:'file merged success'
      })
    )
  }
}