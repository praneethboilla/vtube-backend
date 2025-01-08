import mongoose, { isValidObjectId } from "mongoose"
import { Video } from "../models/video.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import { User } from "../models/user.model.js"


// get all videos based on query of title and description, sort, pagination

const getAllVideos = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, query, sortBy = "createdAt", sortType = "desc", userId } = req.query;

  // Ensure page and limit are integers
  const pageInt = parseInt(page, 10);
  const limitInt = parseInt(limit, 10);

  // Construct the sort object dynamically based on sortBy and sortType
  const sort = {};
  sort[sortBy] = sortType === "desc" ? -1 : 1;

  // Start building the aggregation pipeline
  let pipeline = [
    {
      $sort: sort
    },
    {
      $skip: (pageInt - 1) * limitInt
    },
    {
      $limit: limitInt
    }
  ];

  pipeline.push(
    {
      $lookup: {
        from: "users",  // Join with the 'users' collection
        localField: "owner",  // Field in 'videos' collection that relates to 'users'
        foreignField: "_id",  // Reference the '_id' field in 'users' collection
        as: "ownerDetails",  // Alias for the joined data
        pipeline: [
          {
            $project: {
              username: 1,
              avatar: 1,
            }
          }
        ]
      }
    },
    {
      $unwind: "$ownerDetails"  // Flatten the 'ownerDetails' array
    }
  );

  if (isValidObjectId(userId)) {
    pipeline.unshift({
      $match: {
        owner: new mongoose.Types.ObjectId(userId)
      }
    })
  }

  pipeline.push({ $match: { isPublished: true } });

  // search should be first in pipeline array so unshift adds it to first if query is present
  if (query) {
    pipeline.unshift({
      $search: {
        index: "search-videos",
        text: {
          query: query,
          path: ["title", "description"]
        }
      }
    });
  }

  const videos = await Video.aggregate(pipeline);
  return res
    .status(200)
    .json(new ApiResponse(200, videos, "Videos fetched successfully"));

});

//get video, upload to cloudinary, create video
const publishAVideo = asyncHandler(async (req, res) => {
  const { title, description } = req.body

  if ([title, description].some((field) => field?.trim() === "")) {
    throw new ApiError(400, "All fields are required");
  }

  const videoLocalPath = req.files?.videoFile[0]?.path;
  const thumbnailLocalPath = req.files?.thumbnail[0]?.path;

  const videoFile = await uploadOnCloudinary(videoLocalPath)
  const thumbnail = await uploadOnCloudinary(thumbnailLocalPath)

  if (!videoFile) {
    throw new ApiError(400, "Video file not found");
  }

  if (!thumbnail) {
    throw new ApiError(400, "Thumbnail not found");
  }

  const video = await Video.create({
    title,
    description,
    duration: videoFile.duration,
    videoFile: videoFile.url,
    thumbnail: thumbnail.url,
    owner: req.user?._id,
    isPublished: true
  });

  const videoUploaded = await Video.findById(video._id);

  if (!videoUploaded) {
    throw new ApiError(500, "videoUpload failed please try again !");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, video, "Video uploaded successfully"));
})

const getVideoById = asyncHandler(async (req, res) => {
  const { videoId } = req.params

  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }

  if (!isValidObjectId(req.user?._id)) {
    throw new ApiError(400, "Invalid userId");
  }

  const video = await Video.findById(videoId)

  if (!video) {
    throw new ApiError(500, "failed to fetch video");
  }

  // increment views if video fetched successfully
  await Video.findByIdAndUpdate(videoId, {
    $inc: {
      views: 1
    }
  });

  await User.findByIdAndUpdate(req.user?._id, {
    $addToSet: {
      watchHistory: videoId
    }
  });

  return res
    .status(200)
    .json(new ApiResponse(200, video, "Video fetched successfully"));
})

const updateVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params
  //update video details like title, description, thumbnail

})

const deleteVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params
  //delete video
})

const togglePublishStatus = asyncHandler(async (req, res) => {
  const { videoId } = req.params
})

export {
  getAllVideos,
  publishAVideo,
  getVideoById,
  updateVideo,
  deleteVideo,
  togglePublishStatus
}