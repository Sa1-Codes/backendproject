import {asyncHandler} from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {User} from '../models/user.model.js';
import {uploadOnCloudinary} from '../utils/cloudinary.js';
import { ApiResponse } from '../utils/ApiResponse.js';

const registerUser = asyncHandler(async (req , res) => {
    // get user details from frontend
    // validation 
    // check if user already exists : username , email
    // ckeck for images , check for avatar
    // upload them to cloudinary , avatar
    // create user object - create entry in db
    // remove password and referesh tokrn field from response
    // check user creation
    // return res

    const {fullName , email , username , password} = req.body

    console.log("req.body in user.controller.js ", req.body)

    console.log("email" , email)
    // if (fullName === null) {
    //     throw new ApiError(400 , "fullname is required")
    // }

    if (
        [fullName, email,username,password].some((field)=> field?.trim() === "")
    ) {
       throw new ApiError(400 , "fullname is required") 
    }

    const existedUser =await User.findOne({
        $or:[ { username },{ email } ]
    })

    console.log("existedUser in user.controller.js" , existedUser)

    if (existedUser) {
        throw new ApiError(409 , "User with email or username already exists")
    }
    console.log(req.files)

    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400,"Avatar file is required")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!avatar) {
        throw new ApiError(400 , "avatar file is required")
    }

    const user = await User.create({
        fullName,
        avatar:avatar.url,
        coverImage:coverImage?.url || "",
        email,
        password,
        username:username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if (!createdUser) {
        throw new ApiError(500 , "something went wrong while registering the user")
    }

    return res.status(201).json(
        new ApiResponse(200 , createdUser, "User registeres successfully")
    )


})

export {registerUser}
