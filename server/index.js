const path = require('path')
const fse =require('fs-extra')
// 合并文件块
const UPLOAD_DIR=path.resolve(__dirname,".","target");
// console.log(UPLOAD_DIR);
const filename="video"
const filePath =path.resolve(UPLOAD_DIR,"..",`${filename}.mp4`)


const pipeStream = (path,writeStream)=>
    new Promise(resolve=>{
        const readStream=fse.createReadStream(path)
        readStream.on('end',()=>{
            // fse.unlinkSync(path)
            resolve()
        })
        readStream.pipe(writeStream)
    })

const mergeFileChunk = async(filePath, filename, size) => {
    // console.log(filePath,filename,size);
     const chunkDir=path.resolve(UPLOAD_DIR,filename)
    // console.log(chunkDir);
   const chunkPaths =await fse.readdir(chunkDir)
    // console.log(chunkPaths);
    chunkPaths.sort((a,b)=>a.split('-')[1]-b.split('-')[1])
    // console.log(chunkPaths,'++');
    await Promise.all(
        chunkPaths.map((chunkPath,index)=>{
            pipeStream(
                path.resolve(chunkDir,chunkPath),
                fse.createWriteStream(filePath,{
                    start:index*size,
                    end:(index+1)*size
                })
            )
        })
    )
    console.log('文件合并成功');
    
}

mergeFileChunk(filePath, filename, 1024*1024)