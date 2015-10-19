#!/usr/bin/env node

var glob = require("glob")

console.log("\nwebef-cli v.1.0\n");

var config = getConfigFromCLI();
gen_task(config);







function getConfigFromCLI(){
    //### GET ARGUMENTS
    var args = process.argv.slice(2);
    
    //### GET flags
    var flag = {};
    for (var i=0; i<args.length; i++){
        if (startsWith(args[i], '-')){
            var f = stripLeadingHyphen(args[i]);            
            flag[f.toUpperCase()] = true;
            args.splice(i,1);
        }
    }
    
    // ### FAIL - NOT ENOUGH ARGUMENTS
    if (flag.H || flag['?'] || flag.HELP) {
        console.log(        
            "  Accepts a schema.json as input and generates "+
            "a typescript file containing a DBContext\n"+
            "  Usage: webef <schema_file_name> <db_context_name>");
        process.exit();
    }
    
    //### TRY TO GET INPUT PATH
    
    var globOptions = {
        ignore: [
            "**/node_modules/**/*",
            "**/jspm_packages/**/*",
            "**/bower_packages/**/*"],
        nocase: true
    };
    
    var input;
    if (args.length >0)
        input = args[0].trim();
    else {
        process.stdout.write('  searching for schema.json...');
        var results=glob.sync("**/schema.json",globOptions);
        if (results.length >0){
            input=results[0];
            console.log(' found: '+input);
        }
        else
            console.error("ERROR: schema.json not found!")
    }
    if (!endsWith(input,'.json')){
        if (!endsWith(input,'/')) 
            input += '/schema.json';
        else {
            input += 'schema.json';
        }
    }
    
    //### TRY TO GET CONTEXT NAME
    var contextName;
    if (args.length>1)
        contextName = args[1];    
    else
        contextName = "DBContext";
    
    //TRY TO GET OUTPUT PATH
    var input = {
        path: input.substr(0,input.lastIndexOf('/')),
        file: input.substr(input.lastIndexOf('/'))
    };
    input.path = stripLeadingSlash(input.path)
    
    //GET APP PATH
    process.stdout.write('  searching for tsconfig.json...');
    var results=glob.sync("**/tsconfig.json", globOptions);
    if (results.length===0) {
        console.error("ERROR: Not a typescript project. tsconfig.json could not be found!");    
        process.exit();
    }
    console.log(' found: ' + results[0]);
    var appPath = results[0].substr(0,results[0].lastIndexOf('/'));
    
    //GET APP RELATIVE
    var relativePath;
    if (input.path.substr(appPath) !==-1){
        relativePath = input.path.substr(appPath.length+1)
    }
    
    //GET WEBEF
    results = glob.sync("**/ef.d.ts");
    if (results.length===0){
        console.error("ERROR: Not a WebEF Project. Please install WebEF first!");    
        process.exit();        
    }
    var webefpath='';
    for (var i=0; i<input.path.split('/').length; i++){
        webefpath += '../'
    }
    webefpath += results[0];
    
    //### GET CONFIG ###
    var config = {
        input: input,
        appPath: appPath,
        relativePath: relativePath,
        inputPath: './'+ input.path + input.file,
        schemaPath: '.'+ relativePath + input.file,
        contextName: contextName,
        outputPath: input.path + '/' + contextName.toLowerCase()+'.ts',
        dtsPath: webefpath,
        flag: flag
    }
    return config;
}


function gen_task(config){
    
    process.stdout.write('  generating db context...');
    
    // get schema
    var fs = require("fs");
    var json = fs.readFileSync(config.inputPath);
    var db = JSON.parse(json);
  
    var namemap = {};
    var output = [];
    
    output.push('// WARNING: This file was generated by webef-cli\n\n');
    
    if (config.flag.REFERENCEPATH)
        output.push('///<reference path="'+config.dtsPath+'" />\n')
    
    output.push('import "opsuite/webef";\n');
    
    if (config.flag.LEGACY)
        output.push('WebEF.DBSchema.create(\''+config.schemaPath+'\');\n\n')
    else
        // insert schema json directly into file (prevent sync xmlhttprequest)
        output.push('WebEF.DBSchema.create(\''+db.name+'\','+ db.version +', '+ JSON.stringify(db.schema) +');\n\n');
    
    for (var table in db.schema){
        var name = table.substr(0,1).toUpperCase()+table.substr(1);
        namemap[table] = name;
    }
    
    var dbContextClass = [];
    dbContextClass.push('export class '+ config.contextName +' extends WebEF.DBContext<DBMasterContext> {\n')
    dbContextClass.push('\tconstructor(){super(\''+db.name+'\', lf.schema.DataStoreType.WEB_SQL)}\n')
    
    var masterContextMap = {};
    
    for (var table in db.schema){
        var name = namemap[table];
    
        var entityInterface = [];
        var entityContextInterface = [];
        var contextInterface = [];    
        var otherTables = [];

        entityInterface.push('export interface '+name+' {\n');
        entityContextInterface.push('export interface '+name+'Table extends lf.schema.Table {\n');
        contextInterface.push('export interface '+name+'Context {\n');
        contextInterface.push('\t'+table+'?: '+name+'Table;\n');        
        masterContextMap[table] = '\t'+table+'?: '+name+'Table;\n';  
        
        for(var column in db.schema[table]){
            var def = removeWhiteSpace(db.schema[table][column]);
            
            var nullable = '';
            if (def.indexOf('null')!== -1){
                nullable = '?';
            }               
            if (def.indexOf('pkey')===0 || def.indexOf('fk')===0){
                entityInterface.push('\t'+column+'?: number;\n'); 
                entityContextInterface.push('\t'+column+'?: lf.schema.Column;\n');
            }
            if (def.indexOf('nav->')===0){
                var x=def.split('>')[1].split(':');
                var y=x[1].split('.');
                
                var tableName=x[0];
                var fkTable=y[0];
               
                var isArray = (fkTable !== table);
                var className = namemap[tableName];
                var ifArray = isArray ? '[]' : '';
                entityInterface.push('\t'+column+'?: '+className+ifArray+';\n');
                contextInterface.push('\t'+tableName+'?: '+className+'Table;\n');
                masterContextMap[tableName] = '\t'+tableName+'?: '+className+'Table;\n';                
                otherTables.push(tableName);
            }
            if (def.indexOf('float')===0){
                entityInterface.push('\t'+column+nullable+': number;\n'); 
                entityContextInterface.push('\t'+column+nullable+': lf.schema.Column;\n');                
            }
            if (def.indexOf('string')===0){
                entityInterface.push('\t'+column+nullable+': string;\n'); 
                entityContextInterface.push('\t'+column+nullable+': lf.schema.Column;\n');                
            }
            if (def.indexOf('boolean')===0){
                entityInterface.push('\t'+column+nullable+': boolean;\n'); 
                entityContextInterface.push('\t'+column+nullable+': lf.schema.Column;\n');                
            }                            
            if (def.indexOf('date')===0){
                entityInterface.push('\t'+column+nullable+': Date;\n'); 
                entityContextInterface.push('\t'+column+nullable+': lf.schema.Column;\n');                
            }                     
            if (def.indexOf('int')===0){
                entityInterface.push('\t'+column+nullable+': number;\n'); 
                entityContextInterface.push('\t'+column+nullable+': lf.schema.Column;\n');                
            }   
            if (def.indexOf('object')===0){
                entityInterface.push('\t'+column+nullable+': Object;\n'); 
                entityContextInterface.push('\t'+column+nullable+': lf.schema.Column;\n');                
            }   
            if (def.indexOf('array')===0){
                entityInterface.push('\t'+column+nullable+': any[];\n'); 
                entityContextInterface.push('\t'+column+nullable+': lf.schema.Column;\n');                
            }    
            if (def.indexOf('dbtimestamp')===0){
                entityInterface.push('\t'+column+nullable+'?: number;\n'); 
                entityContextInterface.push('\t'+column+nullable+'?: lf.schema.Column;\n');                
            }              
            if (def.indexOf('isdeleted')===0){
                entityInterface.push('\t'+column+nullable+'?: boolean;\n'); 
                entityContextInterface.push('\t'+column+nullable+'?: lf.schema.Column;\n');                
            }              
                  
        }
        
        dbContextClass.push('\tpublic '+table+' = this.DBEntity<'+name+', '+name+'Context, '+name+'Table>(\''+table+'\', '+JSON.stringify(otherTables)+');\n')
        
        entityInterface.push('}\n\n');
        entityContextInterface.push('}\n\n');
        if (contextInterface.length>0) contextInterface.push('}\n\n');
        
        output.push( entityInterface.join('') )
        output.push( entityContextInterface.join('') )
        output.push( contextInterface.join('') )
    }
    
    var masterContext = [];
    masterContext.push('export interface DBMasterContext {\n');
    for (var key in masterContextMap){
        masterContext.push(masterContextMap[key]);
    }
    masterContext.push('}\n\n');
    output.push( masterContext.join(''));
    
    dbContextClass.push('}\n\n');
    output.push( dbContextClass.join(''));
    var text = output.join('');
    
    var fs = require('fs');
    fs.writeFileSync(config.outputPath, text);    
    
    console.log(' done: ' + config.outputPath);
}
function removeWhiteSpace(str) {
    return str.replace(/\s/g, "");
}
function endsWith(str, search){
    var i=str.indexOf(search);
    return i !== -1 && i === str.length - search.length;
}
function startsWith(str, search){
    return str.trim().indexOf(search) == 0;
}
function contains(str,search){
    return str.indexOf(search) !== -1;
}
function stripLeadingSlash(str){
    if (str.indexOf('/')===0) return str.substr(1);
    if (str.indexOf('./')===0) return str.substr(2);
    return str;
}
function stripLeadingHyphen(str){
    var str = str.trim();
    if (str.indexOf('--')===0) return str.substr(2);
    if (str.indexOf('-')===0) return str.substr(1);
    return str;
}