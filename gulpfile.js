/**
 *  基于gulp的项目构建工具，相比grunt的IO操作，gulp的流操作更加快捷，gulp执行异步任务，task 将以最大的并发数执行，也就是说，gulp 会一次性运行所有的 task 并且不做任何等待，
 *  很多时候我们需要使用插件实现顺序执行（gulp-sequence），
 *  gulp4.0已经原生支持顺序执行（gulp.series）
 *
 * 	gulp的配置信息保存在_config.yml文件下
 * 	
 *  clean，文件清除--del
 *  less, less-文件转化--gulp-less
 *  cssmin, css文件压缩--gulp-cssmin
 *  babel, es6文件转化--webpack
 *  uglify, js文件压缩混淆
 *  ssh, 模块上传服务器--gulp-sftp
 */

//node模块
var gulp = require('gulp'),
	fs = require('fs'),
	path = require('path'),
	del = require('del'), //文件删除,只删除当前工作目录的文件
	minimist = require('minimist'), //参数处理
	webpack = require('webpack'),
	ExtractTextPlugin = require('extract-text-webpack-plugin'),
	HtmlWebpackPlugin = require('html-webpack-plugin'),
	DirectoryNameAsMain = require('webpack-directory-name-as-main'),
	yaml = require('js-yaml')

//gulp插件
var util = require('gulp-util'), //gulputil插件
	less = require('gulp-less'), //gulp-less插件
	sourcemaps = require('gulp-sourcemaps'), //gulp-sourcmap插件
	LessAutoprefix = require('less-plugin-autoprefix'), //gulp-css前缀自动补全less插件
	lessAutoprefix = new LessAutoprefix({
		browsers: ['last 2 versions']
	}),
	cssmin = require('gulp-cssmin'), //gulp-css压缩插件
	rename = require('gulp-rename'), //gulp重命名插件
	sftp = require('gulp-sftp') //gulpsftp插件

var processes = {
	server: null
}

//读取配置信息
var _config = {}

try {
	_config = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'config.yml'), 'utf8'))
} catch (e) {
	console.log('初始化配置信息错误,请检查目录下的config.yml是否正确');
	console.log(e);

	return
}

//参数设置
var args = minimist(process.argv.slice(2), {
		//字符串或者数组, 参数值是否已字符串返回
		string: ['mode'],
		//boolean: 字符串或者数组，参数值是否已boolean值返回
		//设置别名
		alias: {
			mode: 'M'
		},
		//默认值
		default: {
		  	mode: 'develop'
		}
	}),
	isProduct = args.mode === 'product',
	src = _config.src,
	dev = _config.dev,
	pro = _config.pro,
	base = _config.base,
	sftp = _config.sftp,
	server = _config.server;

/**
 * 文件夹清空任务
 * @return {[type]} [description]
 */
function clean(done) {

	if (isProduct) {

		return del(pro.root, {
			force: true
		}).then(function() {
			done()
		});
	}

	return del(dev.root, {
		force: true
	}).then(function() {
		done()
	});
}

/**
 * 清除基础样式库css文件夹
 * @param  {Function} done [description]
 * @return {[type]}        [description]
 */
function cleanBaseLess(done) {
	return del(base.cssDest, {
		force: true
	}).then(function() {
		done()
	});
}

/**
 * 基础样式库
 * @return {[type]} [description]
 */
function less2css_base() {
	return gulp.src(base.less)
		.pipe(sourcemaps.init())
		.pipe(less({
			plugins: [lessAutoprefix]
		}))
		.pipe(sourcemaps.write('./map'))
		.pipe(gulp.dest(base.cssDest));
}

/**
 * baseCSS压缩
 * @return {[type]} [description]
 */
function cssCompress() {
	return gulp.src(base.css)
		.pipe(cssmin())
		.pipe(rename({
			suffix: '.min'
		}))
		.pipe(gulp.dest(base.cssDest));
}

/**
 * 文件发布到服务器
 * @return {[type]} [description]
 */
function ssh() {
	return gulp.src(dest.root)
		.pipe(sftp({
			host: sftp.host,
			port: sftp.port,
			user: sftp.user,
			pass: sftp.pass,
			remotePath: sftp.remotePath || '/home/hahacoo'
		}));
}

/**
 * 打包 webpack
 * @param  {Function} done [description]
 * @return {[type]}        [description]
 */
function webpackBundle(done) {

	//webpack
	var webpackConfig,
		webpackGenerator = require('./webpack.generator')

	if (isProduct) {

		webpackConfig = webpackGenerator(_config, {

			output: {
				path: _config.pro.root, //输出路径
				publicPath: _config.pro.publicPath, //webpack加载资源路径前缀
				filename: '[name].[hash].js', //bundle文件名
				chunkFilename: '[id].[chunkhash].js' //chunk文件名
			},

			watch: false,

			devtool: '#source-map', //sourcemap生成方式

			preLoaders: [
	        	{
					test: /\.es6$/,
					exclude: /(node_modules|libs)/,
					loader: "eslint-loader",
				},
	        ],

			loaders: [{
					test: /\.css$/,
					loader: ExtractTextPlugin.extract("style-loader", "css-loader!postcss-loader")
				}, {
					test: /\.less$/,
					loader: ExtractTextPlugin.extract("style-loader", "css-loader!postcss-loader!less-loader") //可以指定多个extract
				}, {
					test: /\.es6$/,
					exclude: /(node_modules|libs)/,
					loader: "babel-loader",
					query: {
						presets: ['es2015', 'react'],
						plugins: [
							'add-module-exports',
							['transform-runtime', {

								"helpers": true, // defaults to true
							    "polyfill": true, // defaults to true
							    "regenerator": true, // defaults to true
							    "moduleName": "babel-runtime" // defaults to "babel-runtime"
							}]
						]
					}
				}, {
					//文件加载器，处理文件静态资源
					//name: 打包后文件名称
					//publicPath: 打包后文件绝对路径
					//文件输出地址按name属性来决定
					test: /\.(woff|woff2|ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
					loader: 'file-loader?name=/static/fonts/[name].[ext]'
				}, {
					//图片加载器，更适合图片，
					//特点：可以将较小的图片转成base64（data-src），减少http请求
					//如下配置，将小于8192byte的图片转成base64码
					test: /\.(png|jpg|gif)$/,
					loader: 'url-loader?limit=8192&name=../../img/[hash].[ext]'
				}, {
					test: /\.(html|tpl)$/,
					loader: "html?attrs=img:src img:data-src" //处理html中img的资源加载
				}

			],

			plugins: [
				new webpack.ResolverPlugin([
		    		new DirectoryNameAsMain()
		    	]),
				//提取公用组件
		        new webpack.optimize.CommonsChunkPlugin({
		            names: ['commons', 'vendor']
		        }),
		        //文件压缩
	            new webpack.optimize.UglifyJsPlugin({
				    compress: {
				        warnings: true
				    }
				}),
	            //抽取css文件
	            new ExtractTextPlugin("style.css"),
	            //模板文件
	            new HtmlWebpackPlugin({
	                title: _config.name, //网站标题
	                filename: _config.outputPath|| '../../../views/ejs/index.ejs', //html输出地址
	                template: _config.template || './static/js/src/layout.ejs', //模板文件
	                inject: 'body', //js插入位置 head | body
	                hash: false, //为生成的静态资源生成hash值
	                //chunk: [], //需要引入的资源，默认为全部资源
	                minify: {
	                    //压缩html文件
	                    removeComments: true,
	                    collapseWhitespace: true
	                }
	            })
			]

		})
	} else {

		webpackConfig = webpackGenerator(_config, {

			devtool: '#cheap-module-eval-source-map', //sourcemap生成方式

			preLoaders: [
	        	{
					test: /\.es6$/,
					exclude: /(node_modules|libs)/,
					loader: "eslint-loader",
				},
	        ],

			loaders: [
	        	{
					test: /\.css$/,
					loader: "style-loader!css-loader!postcss-loader"
				}, {
					test: /\.less$/,
					//modules&localIdentName=[path][name][local][hash:base64:5]路径|文件名|样式名|编码截取
					//实现css模块化
					loader: "style-loader!css-loader!postcss-loader!less-loader"
				},	{
					test: /\.es6$/,
					exclude: /(node_modules|libs)/,
					loader: "babel-loader",
					query: {
						presets: ['es2015', 'react'],
						plugins: [
							'add-module-exports',
							['transform-runtime', {

								"helpers": true, // defaults to true
							    "polyfill": true, // defaults to true
							    "regenerator": true, // defaults to true
							    "moduleName": "babel-runtime" // defaults to "babel-runtime"
							}]
						]
					}
				}, {
	                //文件加载器，处理文件静态资源
	                //name: 打包后文件名称
	                //publicPath: 打包后文件绝对路径
	                //文件输出地址按name属性来决定
	                test: /\.(woff|woff2|ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
	                loader: 'file-loader?name=/static/fonts/[name].[ext]'
	            }, {
	                //图片加载器，更适合图片，
	                //特点：可以将较小的图片转成base64（data-src），减少http请求
	                //如下配置，将小于8192byte的图片转成base64码
	                test: /\.(png|jpg|gif)$/,
	                loader: 'url-loader?limit=8192&name=../../img/[name].[ext]'
	            }, {
	                test: /\.(html|tpl)$/,
	                loader: "html?attrs=img:src img:data-src" //处理html中img的资源加载
	            }

	        ],

			plugins: [
				new webpack.ResolverPlugin([
		    		new DirectoryNameAsMain()
		    	]),
		        new webpack.optimize.CommonsChunkPlugin({
		            names: ['commons', 'vendor']
		        }),
	            new HtmlWebpackPlugin({
	                title: _config.name,
	                filename: _config.outputPath || '../../../views/ejs/index.ejs',
	                template: _config.template || './static/js/src/layout.ejs',
	                inject: 'body',
	                hash: true, 
	                minify: {
	                    removeComments: false,
	                    collapseWhitespace: false
	                }
	            })
			]
		})

	}

	webpack(webpackConfig, function(err, stats) {

		if (err) throw new util.PluginError("webpack", err);
		util.log("[webpack]", stats.toString({
			// output options
		}));
		done();
	});
}

/**
 * 监控文件变化
 * @return {[type]} [description]
 */
function watch(done) {

	var baseWatch = gulp.watch(base.lessPath, less2css_base)

	done()
}

//捕获异常
process.on('uncaughtException', function(e) {

	//删除空文件uncaughtException，暂时无法解决，官方说4.0已解决，目前仍存在
	//暂时没有找到杀死服务器进程的方法，先通过异常捕获，阻止gulp进程异常结束
	util.log(util.colors.red(e))
});

//打包源文件
gulp.task('bundle', webpackBundle)

//编译基础样式库
gulp.task('complie:base', gulp.series(
	cleanBaseLess,
	less2css_base,
	cssCompress
));

//编译
gulp.task('complie', gulp.parallel(
	gulp.series(cleanBaseLess, less2css_base, cssCompress),
	gulp.series(clean, 'bundle')
));

//上传服务器
gulp.task('publish', ssh)


if (isProduct) {

	//默认product task，编译
	gulp.task('default', gulp.series('complie'))

} else {

	//默认develop task，编译--监听
	gulp.task('default', gulp.series('complie', watch))

}