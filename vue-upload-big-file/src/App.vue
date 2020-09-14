<template>
  <div id="app">
    <div>
      <input type="file" @change="handleFileChange" />
      <el-button @click="handleUpload">上传</el-button>
      <el-button @click="handlePause">暂停</el-button>
      <el-button @click="handleResume">恢复</el-button>
    </div>
    <div>
      <div>计算文件hash</div>
      <el-progress :percentage="hashPercentage"></el-progress>
      <div>总进度</div>
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </div>
    <el-table :data="data">
      <el-table-column prop="hash" label="切片hash" align="center"></el-table-column>
      <el-table-column label="大小(kb)" align="center" width="120">
        <template v-slot="{row}">{{row.size|transformByte}}</template>
      </el-table-column>
      <el-table-column label="大小(kb)" align="center" width="120">
        <template v-slot="{row}">{{row.size|transformByte}}</template>
      </el-table-column>
      <el-table-column label="进度" align="center" width="120">
        <template v-slot="{row}">
          <el-progress :percentage="row.percentage" color="#090300"></el-progress>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script>
const Status = {
  wait: "wait",
  pause: "pause",
  uploading: "uploading",
  done: "done",
  error: "error"
};
const SIZE = 3 * 1024 * 1024;
export default {
  name: "App",
  filters: {
    transformByte(val) {
      return Number((val / 1024).toFixed(0));
    }
  },
  computed: {
    uploadPercentage() {
      if (!this.container.file || !this.data.length) return 0;
      const loaded = this.data
        .map(item => item.size * item.percentage)
        .reduce((acc, cur) => acc + cur);
      return parseInt((loaded / this.container.file.size).toFixed(2));
    }
  },
  watch: {
    uploadPercentage(newVal) {
      if (newVal > this.fakeUploadPercentage) {
        this.fakeUploadPercentage = newVal;
      }
    }
  },
  data: () => ({
    container: {
      file: null,
      hash: "" //文件总哈希
    },
    status: Status.wait,
    hashPercentage: 0,
    data: [], //上传数据
    requestList: [], //xhr 请求数组
    fakeUploadPercentage: 0 //总进度
  }),
  methods: {
    async handleResume() {
      this.status = Status.uploading;
      const { uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      await this.uploadChunks(this.requestList);
    },
    handlePause() {
      this.status = Status.pause;
      this.resetData();
    },
    resetData() {
      this.requestList.forEach(xhr => xhr.abort());
      this.requestList = [];
      if (this.container.worker) {
        this.container.worker.onmessage = null;
      }
    },
    async mergeRequest() {
      await this.request({
        url: "http://localhost:3000/merge",
        headers: {
          "content-type": "application/json"
        },
        data: JSON.stringify({
          size: SIZE,
          fileHash: this.container.hash,
          filename: this.container.file.name
        })
      });
      this.$message.success("上传成功");
      this.status = Status.wait;
    },
    request({
      url,
      method = "POST",
      data,
      onProgress = e => e,
      headers = {},
      requestList
    }) {
      return new Promise((resolve,reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.upload.onprogress = onProgress;
        Object.keys(headers).forEach(key => {
          xhr.setRequestHeader(key, headers[key]);
        });
        xhr.send(data);
        xhr.onload = e => {
          debugger
          if(xhr.status===200){
            if (requestList) {
              // xhr已经完成
              const xhrIndex = requestList.findIndex(item => item === xhr);
              requestList.splice(xhrIndex, 1);
            }
            resolve({
              data: e.target.response
            });
          }else if(xhr.status===500){
            reject()
          }
        };
        if (requestList) {
          requestList.push(xhr);
        }
      });
    },
    async calculateHash(fileChunkList) {
      return new Promise(resolve => {
        this.container.worker = new Worker("/hash.js");
        this.container.worker.postMessage({ fileChunkList });
        this.container.worker.onmessage = e => {
          console.log(e.data);
          const { percentage, hash } = e.data;
          this.hashPercentage = percentage;
          if (hash) {
            resolve(hash);
          }
        };
      });
    },
    async handleUpload(e) {
      if (!this.container.file) return;
      this.status = Status.uploading;

      const fileChunkList = this.createFileChunk(this.container.file);
      this.container.hash = await this.calculateHash(fileChunkList);
      // 上传验证
      const { shouldUpload, uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      if (!shouldUpload) {
        this.$message.success("秒传：上传成功");
        this.status = Status.wait;
        return;
      }
      this.data = fileChunkList.map(({ file }, index) => ({
        fileHash: this.container.hash,
        index,
        hash: this.container.hash + "-" + index,
        chunk: file,
        size: file.size,
        percentage: uploadedList.includes(index) ? 100 : 0 //当前切片是否已经上传过
      }));
      await this.uploadChunks(uploadedList);
    },
    async sendRequest(forms,max=4){
      return new Promise((resolve,reject)=>{
        const len = forms.length
        let idx = 0
        let counter = 0
        const retryArr = []
        const start = async()=>{
          while(counter<len && max > 0){
            max--;
            //根据状态 并发重试与报错
            const i = forms.findIndex(v=>v.status==Status.wait || v.status==Status.error)
            if(i==-1) break
            forms[i].status=Status.uploading
            let partFormData = forms[i].formData
            let index = forms[i].index
            if(typeof retryArr[index]=='number'){
              console.log(index,'开始重试');
            }
             this.request({
                url: "http://localhost:3000/upload",
                onProgress: this.createProgressHandler(this.data[index]),
                data: partFormData,
                requestList: this.requestList
            }).then(()=>{
              forms[i].status=Status.done
              max++
              counter++
              if(counter == len){
                resolve()
              }else{
                start()
              }
            }).catch(()=>{
              forms[i].status = Status.error
              if(typeof retryArr[index]!=='number'){
                retryArr[index] = 0
              }
              // 次数累加
              retryArr[index]++
              
              console.log(index,retryArr[index],'次报错');
              //重发直至成功
              max++
              start()
            })
          }
        }
        start()
      })
    },
    async uploadChunks(uploadedList = []) {
      console.log(uploadedList);
      const requestList = this.data
        .map(({ chunk, hash, index }) => {
          const formData = new FormData();
          formData.append("chunk", chunk);
          formData.append("hash", hash);
          formData.append("filename", this.container.file.name);
          formData.append("fileHash", this.container.hash);
          return { formData, index,status:Status.wait };
        })
       /*  .map(async ({ formData, index }) => {
          this.request({
            url: "http://localhost:3000/upload",
            onProgress: this.createProgressHandler(this.data[index]),
            data: formData,
            requestList: this.requestList
          });
        }); */
      // await Promise.all(requestList);
      const ret = await this.sendRequest(requestList,4)
      console.log("可以发送合并请求了");
      console.log("this.data", this.data.length, this.data);

        debugger
      if (uploadedList.length + requestList.length == this.data.length) {
        await this.mergeRequest();
      }
    },
    createProgressHandler(item) {
      return e => {
        item.percentage = parseInt(String((e.loaded / e.total) * 100));
        console.log(e.loaded);
      };
    },
    async verifyUpload(filename, fileHash) {
      const { data } = await this.request({
        url: "http://localhost:3000/verify",
        headers: {
          "content-type": "application/json"
        },
        data: JSON.stringify({
          filename,
          fileHash
        })
      });
      return JSON.parse(data);
    },
    createFileChunk(file, size = SIZE) {
      const fileChunkList = [];
      let cur = 0;
      while (cur < file.size) {
        fileChunkList.push({
          file: file.slice(cur, cur + size)
        });
        cur += size;
      }
      console.log(fileChunkList);

      return fileChunkList;
    },
    handleFileChange(e) {
      const [file] = e.target.files;
      this.container.file = file;
      this.resetData();
      Object.assign(this.data, this.$options.data());
      Object.assign(this.hashPercentage, this.$options.data());
    }
  }
};
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
